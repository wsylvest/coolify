import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "../trpc";
import { users, teams, teamMembers } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { createId } from "@paralleldrive/cuid2";

export const authRouter = createTRPCRouter({
  /**
   * Get the current user's session
   */
  getSession: publicProcedure.query(({ ctx }) => {
    return ctx.session;
  }),

  /**
   * Register a new user
   */
  register: publicProcedure
    .input(
      z.object({
        name: z.string().min(2).max(255),
        email: z.string().email(),
        password: z.string().min(8).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if user already exists
      const existingUser = await ctx.db.query.users.findFirst({
        where: eq(users.email, input.email),
      });

      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A user with this email already exists",
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(input.password, 12);

      // Create user
      const [user] = await ctx.db
        .insert(users)
        .values({
          name: input.name,
          email: input.email,
          password: hashedPassword,
        })
        .returning();

      if (!user) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create user",
        });
      }

      // Create personal team
      const [team] = await ctx.db
        .insert(teams)
        .values({
          name: `${input.name}'s Team`,
          personalTeam: true,
        })
        .returning();

      if (!team) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create team",
        });
      }

      // Add user as team owner
      await ctx.db.insert(teamMembers).values({
        teamId: team.id,
        userId: user.id,
        role: "owner",
      });

      return {
        id: user.id,
        name: user.name,
        email: user.email,
      };
    }),

  /**
   * Get current user profile
   */
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, ctx.session.user.id),
      columns: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        emailVerifiedAt: true,
        twoFactorConfirmedAt: true,
        marketingEmails: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    return user;
  }),

  /**
   * Update user profile
   */
  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(255).optional(),
        marketingEmails: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(users)
        .set(input)
        .where(eq(users.id, ctx.session.user.id))
        .returning();

      return updated;
    }),

  /**
   * Change password
   */
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string(),
        newPassword: z.string().min(8).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.session.user.id),
      });

      if (!user?.password) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot change password for OAuth accounts",
        });
      }

      const isValid = await bcrypt.compare(input.currentPassword, user.password);
      if (!isValid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Current password is incorrect",
        });
      }

      const hashedPassword = await bcrypt.hash(input.newPassword, 12);
      await ctx.db
        .update(users)
        .set({ password: hashedPassword })
        .where(eq(users.id, ctx.session.user.id));

      return { success: true };
    }),
});
