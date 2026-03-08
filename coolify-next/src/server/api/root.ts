import { createCallerFactory, createTRPCRouter } from "./trpc";
import { authRouter } from "./routers/auth";
import { teamsRouter } from "./routers/teams";
import { serversRouter } from "./routers/servers";
import { projectsRouter } from "./routers/projects";
import { applicationsRouter } from "./routers/applications";
import { databasesRouter } from "./routers/databases";
import { servicesRouter } from "./routers/services";
import { deploymentsRouter } from "./routers/deployments";
import { privateKeysRouter } from "./routers/private-keys";

/**
 * Root tRPC router combining all domain routers
 */
export const appRouter = createTRPCRouter({
  auth: authRouter,
  teams: teamsRouter,
  servers: serversRouter,
  projects: projectsRouter,
  applications: applicationsRouter,
  databases: databasesRouter,
  services: servicesRouter,
  deployments: deploymentsRouter,
  privateKeys: privateKeysRouter,
});

export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API
 */
export const createCaller = createCallerFactory(appRouter);
