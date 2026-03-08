import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { db } from "@/server/db";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth/config";

/**
 * Context that is passed to every tRPC procedure
 */
export interface TRPCContext {
  db: typeof db;
  session: Session | null;
  headers: Headers;
}

/**
 * Create the context for each request
 */
export const createTRPCContext = async (opts: {
  headers: Headers;
}): Promise<TRPCContext> => {
  const session = await getServerSession(authOptions);

  return {
    db,
    session,
    headers: opts.headers,
  };
};

/**
 * Initialize tRPC with superjson transformer and error formatting
 */
const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

/**
 * Create a server-side caller for tRPC procedures
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * Export router and procedure helpers
 */
export const createTRPCRouter = t.router;

/**
 * Middleware to log request timing
 */
const timingMiddleware = t.middleware(async ({ path, next }) => {
  const start = Date.now();

  const result = await next();

  const duration = Date.now() - start;
  if (duration > 100) {
    console.log(`[TRPC] ${path} took ${duration}ms`);
  }

  return result;
});

/**
 * Public (unauthenticated) procedure
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Protected (authenticated) procedure - requires a valid session
 */
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You must be logged in to perform this action",
      });
    }

    return next({
      ctx: {
        ...ctx,
        session: ctx.session,
      },
    });
  });

/**
 * Team-scoped procedure - requires a valid session and team context
 */
export const teamProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  // Get the user's current team from session or default to first team
  const userId = ctx.session.user.id;

  // Query user's teams
  const userTeams = await ctx.db.query.teamMembers.findMany({
    where: (members, { eq }) => eq(members.userId, userId),
    with: {
      team: true,
    },
  });

  if (userTeams.length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You must be a member of a team to perform this action",
    });
  }

  // Use first team as default (in production, this would come from session/cookie)
  const currentTeam = userTeams[0]!.team;

  return next({
    ctx: {
      ...ctx,
      team: currentTeam,
      teamMember: userTeams[0]!,
    },
  });
});

/**
 * Admin procedure - requires admin role
 */
export const adminProcedure = teamProcedure.use(async ({ ctx, next }) => {
  if (ctx.teamMember.role !== "owner" && ctx.teamMember.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You must be a team admin to perform this action",
    });
  }

  return next({ ctx });
});
