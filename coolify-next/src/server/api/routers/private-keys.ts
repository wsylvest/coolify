import { z } from "zod";
import { createTRPCRouter, teamProcedure, adminProcedure } from "../trpc";
import { privateKeys } from "@/server/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { wasmCryptoService } from "@/server/services/wasm";

export const privateKeysRouter = createTRPCRouter({
  /**
   * List all private keys for the current team
   */
  list: teamProcedure.query(async ({ ctx }) => {
    const keys = await ctx.db.query.privateKeys.findMany({
      where: and(
        eq(privateKeys.teamId, ctx.team.id),
        isNull(privateKeys.deletedAt)
      ),
      columns: {
        id: true,
        uuid: true,
        name: true,
        description: true,
        fingerprint: true,
        isDefault: true,
        isGitRelated: true,
        createdAt: true,
      },
      orderBy: (keys, { desc }) => [desc(keys.createdAt)],
    });

    return keys;
  }),

  /**
   * Get private key by ID (without the actual key for security)
   */
  getById: teamProcedure
    .input(z.object({ keyId: z.string() }))
    .query(async ({ ctx, input }) => {
      const key = await ctx.db.query.privateKeys.findFirst({
        where: and(
          eq(privateKeys.id, input.keyId),
          eq(privateKeys.teamId, ctx.team.id),
          isNull(privateKeys.deletedAt)
        ),
        columns: {
          id: true,
          uuid: true,
          name: true,
          description: true,
          publicKey: true,
          fingerprint: true,
          isDefault: true,
          isGitRelated: true,
          createdAt: true,
        },
      });

      if (!key) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Private key not found",
        });
      }

      return key;
    }),

  /**
   * Create a new private key
   */
  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(2).max(255),
        description: z.string().optional(),
        privateKey: z.string().min(1),
        isDefault: z.boolean().default(false),
        isGitRelated: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Calculate fingerprint from private key
      let fingerprint: string | undefined;
      let publicKey: string | undefined;

      try {
        // Try to extract public key and fingerprint
        const keyObject = crypto.createPrivateKey(input.privateKey);
        const pubKey = crypto.createPublicKey(keyObject);
        publicKey = pubKey.export({ type: "spki", format: "pem" }) as string;

        // Generate fingerprint (SHA256 of public key)
        const pubKeyDer = pubKey.export({ type: "spki", format: "der" });
        fingerprint = crypto
          .createHash("sha256")
          .update(pubKeyDer)
          .digest("hex")
          .match(/.{2}/g)
          ?.join(":");
      } catch {
        // Key might be in OpenSSH format or invalid
        // We'll still save it and validate later
      }

      // If setting as default, unset other defaults
      if (input.isDefault) {
        await ctx.db
          .update(privateKeys)
          .set({ isDefault: false })
          .where(eq(privateKeys.teamId, ctx.team.id));
      }

      const [key] = await ctx.db
        .insert(privateKeys)
        .values({
          teamId: ctx.team.id,
          name: input.name,
          description: input.description,
          privateKey: input.privateKey,
          publicKey,
          fingerprint,
          isDefault: input.isDefault,
          isGitRelated: input.isGitRelated,
        })
        .returning({
          id: privateKeys.id,
          uuid: privateKeys.uuid,
          name: privateKeys.name,
          description: privateKeys.description,
          fingerprint: privateKeys.fingerprint,
          isDefault: privateKeys.isDefault,
          isGitRelated: privateKeys.isGitRelated,
          createdAt: privateKeys.createdAt,
        });

      return key;
    }),

  /**
   * Update private key
   */
  update: adminProcedure
    .input(
      z.object({
        keyId: z.string(),
        name: z.string().min(2).max(255).optional(),
        description: z.string().optional(),
        privateKey: z.string().min(1).optional(),
        isDefault: z.boolean().optional(),
        isGitRelated: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { keyId, ...updateData } = input;

      const key = await ctx.db.query.privateKeys.findFirst({
        where: and(
          eq(privateKeys.id, keyId),
          eq(privateKeys.teamId, ctx.team.id)
        ),
      });

      if (!key) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Private key not found",
        });
      }

      // If setting as default, unset other defaults
      if (input.isDefault) {
        await ctx.db
          .update(privateKeys)
          .set({ isDefault: false })
          .where(eq(privateKeys.teamId, ctx.team.id));
      }

      // If updating the private key, recalculate fingerprint
      if (input.privateKey) {
        try {
          const keyObject = crypto.createPrivateKey(input.privateKey);
          const pubKey = crypto.createPublicKey(keyObject);
          const publicKeyPem = pubKey.export({
            type: "spki",
            format: "pem",
          }) as string;
          const pubKeyDer = pubKey.export({ type: "spki", format: "der" });
          const fingerprint = crypto
            .createHash("sha256")
            .update(pubKeyDer)
            .digest("hex")
            .match(/.{2}/g)
            ?.join(":");

          Object.assign(updateData, {
            publicKey: publicKeyPem,
            fingerprint,
          });
        } catch {
          // Ignore fingerprint calculation errors
        }
      }

      const [updated] = await ctx.db
        .update(privateKeys)
        .set(updateData)
        .where(eq(privateKeys.id, keyId))
        .returning({
          id: privateKeys.id,
          uuid: privateKeys.uuid,
          name: privateKeys.name,
          description: privateKeys.description,
          fingerprint: privateKeys.fingerprint,
          isDefault: privateKeys.isDefault,
          isGitRelated: privateKeys.isGitRelated,
          createdAt: privateKeys.createdAt,
        });

      return updated;
    }),

  /**
   * Delete private key
   */
  delete: adminProcedure
    .input(z.object({ keyId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const key = await ctx.db.query.privateKeys.findFirst({
        where: and(
          eq(privateKeys.id, input.keyId),
          eq(privateKeys.teamId, ctx.team.id)
        ),
      });

      if (!key) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Private key not found",
        });
      }

      // Check if key is in use by any servers
      const serversUsingKey = await ctx.db.query.servers.findFirst({
        where: eq(privateKeys.id, input.keyId),
      });

      if (serversUsingKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot delete private key that is in use by servers",
        });
      }

      await ctx.db
        .update(privateKeys)
        .set({ deletedAt: new Date() })
        .where(eq(privateKeys.id, input.keyId));

      return { success: true };
    }),

  /**
   * Generate a new SSH key pair
   */
  generate: adminProcedure
    .input(
      z.object({
        name: z.string().min(2).max(255),
        description: z.string().optional(),
        type: z.enum(["rsa", "ed25519"]).default("ed25519"),
        isDefault: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Generate key pair
      const { privateKey, publicKey } = crypto.generateKeyPairSync(
        input.type === "ed25519" ? "ed25519" : "rsa",
        input.type === "rsa"
          ? {
              modulusLength: 4096,
              publicKeyEncoding: { type: "spki", format: "pem" },
              privateKeyEncoding: { type: "pkcs8", format: "pem" },
            }
          : {
              publicKeyEncoding: { type: "spki", format: "pem" },
              privateKeyEncoding: { type: "pkcs8", format: "pem" },
            }
      );

      // Calculate fingerprint
      const pubKeyDer = crypto
        .createPublicKey(publicKey)
        .export({ type: "spki", format: "der" });
      const fingerprint = crypto
        .createHash("sha256")
        .update(pubKeyDer)
        .digest("hex")
        .match(/.{2}/g)
        ?.join(":");

      // If setting as default, unset other defaults
      if (input.isDefault) {
        await ctx.db
          .update(privateKeys)
          .set({ isDefault: false })
          .where(eq(privateKeys.teamId, ctx.team.id));
      }

      const [key] = await ctx.db
        .insert(privateKeys)
        .values({
          teamId: ctx.team.id,
          name: input.name,
          description: input.description,
          privateKey: privateKey as string,
          publicKey: publicKey as string,
          fingerprint,
          isDefault: input.isDefault,
        })
        .returning();

      return {
        id: key!.id,
        uuid: key!.uuid,
        name: key!.name,
        publicKey: publicKey as string,
        fingerprint,
      };
    }),
});
