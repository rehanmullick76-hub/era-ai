import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const authSessionsTable = pgTable(
  "era_auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIndex: index("era_auth_sessions_user_id_idx").on(table.userId),
    expiresAtIndex: index("era_auth_sessions_expires_at_idx").on(table.expiresAt),
  }),
);

export type AuthSession = typeof authSessionsTable.$inferSelect;
