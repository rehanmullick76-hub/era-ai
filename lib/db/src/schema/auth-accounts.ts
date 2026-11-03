import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const authAccountsTable = pgTable(
  "era_auth_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("google"),
    providerUserId: text("provider_user_id").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    providerUserUnique: uniqueIndex("era_auth_accounts_provider_user_uq").on(
      table.provider,
      table.providerUserId,
    ),
    userProviderUnique: uniqueIndex("era_auth_accounts_user_provider_uq").on(
      table.userId,
      table.provider,
    ),
  }),
);

export type AuthAccount = typeof authAccountsTable.$inferSelect;
