import { and, eq, gte, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { decideDailyAiCall } from "./dailyAiCallPolicy";
import { settleCreditUsage, type TokenUsage } from "./token-billing";
export { DAILY_AI_CALL_LIMIT_MESSAGE } from "./dailyAiCallPolicy";

export const INITIAL_CREDITS = 100;

export async function ensureUser(userId: string): Promise<void> {
  await db.insert(usersTable)
    .values({ id: userId, credits: INITIAL_CREDITS })
    .onConflictDoNothing({ target: usersTable.id });
}

export async function reserveCredits(userId: string, amount: number): Promise<number | null> {
  await ensureUser(userId);
  const [updated] = await db.update(usersTable)
    .set({
      credits: sql`${usersTable.credits} - ${amount}`,
      updatedAt: new Date(),
    })
    .where(and(eq(usersTable.id, userId), gte(usersTable.credits, amount)))
    .returning({ credits: usersTable.credits });
  return updated?.credits ?? null;
}

export async function reserveDailyAiCall(userId: string): Promise<boolean> {
  await ensureUser(userId);
  const now = new Date();
  return db.transaction(async (tx) => {
    const [current] = await tx.select({
      callsUsed: usersTable.dailyAiCallsUsed,
      resetAt: usersTable.dailyResetAt,
    })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update");
    if (!current) return false;

    const decision = decideDailyAiCall(current, now);
    if (!decision.allowed) return false;

    const [updated] = await tx.update(usersTable)
      .set({
        dailyAiCallsUsed: decision.callsUsed,
        dailyResetAt: decision.resetAt,
        updatedAt: now,
      })
      .where(eq(usersTable.id, userId))
      .returning({ id: usersTable.id });
    return updated !== undefined;
  });
}

export async function refundCredits(userId: string, amount: number): Promise<void> {
  await db.update(usersTable)
    .set({
      credits: sql`${usersTable.credits} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));
}

export async function settleCreditsForUsage(
  userId: string,
  reservedCredits: number,
  usage: TokenUsage,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ credits: usersTable.credits })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update");
    if (!user) throw new Error("User account not found.");
    const settlement = settleCreditUsage(usage, reservedCredits, user.credits);
    const adjustment = settlement.refund - settlement.additionalCharge;
    if (adjustment === 0) return user.credits;
    const [updated] = await tx.update(usersTable)
      .set({
        credits: sql`${usersTable.credits} + ${adjustment}`,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId))
      .returning({ credits: usersTable.credits });
    if (!updated) throw new Error("Token-based credit settlement failed.");
    return updated.credits;
  });
}

export async function refundDailyAiCall(userId: string, reservedAt: Date): Promise<void> {
  const windowEnd = new Date(reservedAt);
  windowEnd.setUTCHours(24, 0, 0, 0);
  // A job from yesterday must never decrement today's allowance.
  await db.update(usersTable)
    .set({
      dailyAiCallsUsed: sql`greatest(0, ${usersTable.dailyAiCallsUsed} - 1)`,
      updatedAt: new Date(),
    })
    .where(and(eq(usersTable.id, userId), eq(usersTable.dailyResetAt, windowEnd)));
}

export async function addCreditsForUser(userId: string, amount: number, executor: Pick<typeof db, "update"> = db): Promise<number> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Credit amount must be a positive integer.");
  }
  await ensureUser(userId);
  const [updated] = await executor.update(usersTable)
    .set({
      credits: sql`${usersTable.credits} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId))
    .returning({ credits: usersTable.credits });
  if (!updated) throw new Error("User credit balance could not be updated.");
  return updated.credits;
}

export async function getCredits(userId: string): Promise<number> {
  await ensureUser(userId);
  const [user] = await db.select({ credits: usersTable.credits })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return user?.credits ?? INITIAL_CREDITS;
}