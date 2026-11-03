import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const googleOAuthStatesTable = pgTable("era_google_oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  nonce: text("nonce").notNull(),
  codeVerifier: text("code_verifier").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  returnTo: text("return_to").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GoogleOAuthState = typeof googleOAuthStatesTable.$inferSelect;
