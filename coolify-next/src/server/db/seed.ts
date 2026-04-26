import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import bcrypt from "bcryptjs";
import { createId } from "@paralleldrive/cuid2";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client, { schema });

async function seed() {
  console.log("Seeding database...");

  const hashedPassword = await bcrypt.hash("password", 12);

  // Create default user
  const [user] = await db
    .insert(schema.users)
    .values({
      id: createId(),
      name: "Admin",
      email: "test@example.com",
      password: hashedPassword,
    })
    .onConflictDoNothing({ target: schema.users.email })
    .returning();

  if (!user) {
    console.log("User already exists, skipping seed.");
    await client.end();
    return;
  }

  console.log(`Created user: ${user.email}`);

  // Create personal team
  const [team] = await db
    .insert(schema.teams)
    .values({
      id: createId(),
      name: "Admin's Team",
      personalTeam: true,
    })
    .returning();

  console.log(`Created team: ${team!.name}`);

  // Add user as team owner
  await db.insert(schema.teamMembers).values({
    id: createId(),
    teamId: team!.id,
    userId: user.id,
    role: "owner",
  });

  // Create localhost server
  const [server] = await db
    .insert(schema.servers)
    .values({
      id: createId(),
      teamId: team!.id,
      name: "localhost",
      description: "Local Docker host",
      ip: "host.docker.internal",
      port: 22,
      user: "root",
    })
    .returning();

  console.log(`Created server: ${server!.name}`);

  // Create default destination
  const [destination] = await db
    .insert(schema.destinations)
    .values({
      id: createId(),
      serverId: server!.id,
      name: "Local Docker",
      type: "standalone_docker",
      network: "coolify",
    })
    .returning();

  console.log(`Created destination: ${destination!.name}`);

  // Create sample project
  const [project] = await db
    .insert(schema.projects)
    .values({
      id: createId(),
      teamId: team!.id,
      name: "My First Project",
    })
    .returning();

  console.log(`Created project: ${project!.name}`);

  // Create production environment
  const [env] = await db
    .insert(schema.environments)
    .values({
      id: createId(),
      projectId: project!.id,
      name: "production",
    })
    .returning();

  console.log(`Created environment: ${env!.name}`);

  console.log("\nSeed complete! Login with:");
  console.log("  Email:    test@example.com");
  console.log("  Password: password");

  await client.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
