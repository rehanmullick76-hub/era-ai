import { integer, text, timestamp, pgTable } from "drizzle-orm/pg-core";

export const usersTable = pgTable("era_users", {
  id: text("id").primaryKey(),
  credits: integer("credits").notNull().default(100),
  dailyAiCallsUsed: integer("daily_ai_calls_used").notNull().default(0),
  dailyResetAt: timestamp("daily_reset_at").notNull().defaultNow(),
  guestTokenHash: text("guest_token_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;