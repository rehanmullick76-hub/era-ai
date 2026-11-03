import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Request } from "express";
import {
  authAccountsTable,
  authSessionsTable,
  db,
  usersTable,
} from "@workspace/db";
import { INITIAL_CREDITS } from "./credits";

export const AUTH_SESSION_COOKIE = "era_session";
export const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isMissingAuthSchema(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "42P01",
  );
}

export async function createAuthSession(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_MS);
  await db.insert(authSessionsTable).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function resolveAuthSession(token: unknown): Promise<string | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return null;
  }
  try {
    const [session] = await db
      .select({ userId: authSessionsTable.userId })
      .from(authSessionsTable)
      .where(
        and(
          eq(authSessionsTable.tokenHash, hashToken(token)),
          gt(authSessionsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return session?.userId ?? null;
  } catch (error) {
    if (isMissingAuthSchema(error)) return null;
    throw error;
  }
}

export function getAuthenticatedSessionUser(req: Pick<Request, "cookies">): Promise<string | null> {
  return resolveAuthSession(req.cookies?.[AUTH_SESSION_COOKIE]);
}

export async function revokeAuthSession(token: unknown): Promise<void> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  try {
    await db
      .delete(authSessionsTable)
      .where(eq(authSessionsTable.tokenHash, hashToken(token)));
  } catch (error) {
    if (!isMissingAuthSchema(error)) throw error;
  }
}

export interface GoogleProfile {
  subject: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export async function findOrCreateGoogleUser(profile: GoogleProfile): Promise<string> {
  return db.transaction(async (tx) => {
    const findAccount = () =>
      tx
        .select({ userId: authAccountsTable.userId })
        .from(authAccountsTable)
        .where(
          and(
            eq(authAccountsTable.provider, "google"),
            eq(authAccountsTable.providerUserId, profile.subject),
          ),
        )
        .limit(1);

    const [existing] = await findAccount();
    if (existing) {
      await tx
        .update(authAccountsTable)
        .set({
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(authAccountsTable.provider, "google"),
            eq(authAccountsTable.providerUserId, profile.subject),
          ),
        );
      return existing.userId;
    }

    const userId = randomUUID();
    await tx.insert(usersTable).values({
      id: userId,
      credits: INITIAL_CREDITS,
    });

    const [created] = await tx
      .insert(authAccountsTable)
      .values({
        id: randomUUID(),
        userId,
        provider: "google",
        providerUserId: profile.subject,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
      })
      .onConflictDoNothing({
        target: [authAccountsTable.provider, authAccountsTable.providerUserId],
      })
      .returning({ userId: authAccountsTable.userId });

    if (created) return created.userId;

    await tx.delete(usersTable).where(eq(usersTable.id, userId));
    const [winner] = await findAccount();
    if (!winner) throw new Error("Google account could not be created.");
    return winner.userId;
  });
}
