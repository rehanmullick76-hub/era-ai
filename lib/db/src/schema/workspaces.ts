import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

// Credentials are encrypted by the server; never serialize this table directly.
export const workspacesTable = pgTable("project_workspaces", {
  projectId: uuid("project_id").primaryKey().references(() => projectsTable.id),
  userId: text("user_id").notNull(),
  state: text("state").notNull().default("queued"),
  action: text("action"),
  phase: text("phase").notNull().default("Waiting"),
  sandboxId: text("sandbox_id"),
  databaseId: text("database_id"),
  credentials: text("credentials"),
  revision: text("revision"),
  logs: text("logs").notNull().default(""),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  starts: integer("starts").notNull().default(0),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  runtimeUntil: timestamp("runtime_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Never reset on project deletion: guest account rotation must not reset limits.
export const runtimeBudgetTable = pgTable("runtime_budget", {
  id: text("id").primaryKey(),
  provisions: integer("provisions").notNull().default(0),
  reservedCents: integer("reserved_cents").notNull().default(0),
});
