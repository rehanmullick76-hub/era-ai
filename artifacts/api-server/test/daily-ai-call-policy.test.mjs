import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DAILY_AI_CALL_CAP,
  DAILY_AI_CALL_LIMIT_MESSAGE,
  dailyAiCallLimitFailure,
  decideDailyAiCall,
} from "../src/lib/dailyAiCallPolicy.ts";

test("allows ten calls in a daily window and rejects the eleventh", () => {
  const now = new Date("2026-10-08T10:00:00.000Z");
  let state = {
    callsUsed: 0,
    resetAt: new Date("2026-10-09T00:00:00.000Z"),
  };

  for (let expectedCount = 1; expectedCount <= DAILY_AI_CALL_CAP; expectedCount++) {
    const decision = decideDailyAiCall(state, now);
    assert.equal(decision.allowed, true);
    assert.equal(decision.callsUsed, expectedCount);
    state = { callsUsed: decision.callsUsed, resetAt: decision.resetAt };
  }

  assert.deepEqual(decideDailyAiCall(state, now), {
    ...state,
    allowed: false,
  });
  assert.deepEqual(dailyAiCallLimitFailure(), {
    status: 429,
    error: DAILY_AI_CALL_LIMIT_MESSAGE,
  });
});

test("an expired window resets the count and schedules the next UTC midnight", () => {
  const now = new Date("2026-10-08T23:59:59.000Z");
  const decision = decideDailyAiCall({
    callsUsed: DAILY_AI_CALL_CAP,
    resetAt: new Date("2026-10-08T23:59:58.000Z"),
  }, now);

  assert.deepEqual(decision, {
    allowed: true,
    callsUsed: 1,
    resetAt: new Date("2026-10-09T00:00:00.000Z"),
  });
});

test("one user's exhausted cap does not block another user's calls", () => {
  const now = new Date("2026-10-08T10:00:00.000Z");
  const resetAt = new Date("2026-10-09T00:00:00.000Z");
  const users = new Map([
    ["user-a", { callsUsed: DAILY_AI_CALL_CAP, resetAt }],
    ["user-b", { callsUsed: 0, resetAt }],
  ]);

  assert.equal(decideDailyAiCall(users.get("user-a"), now).allowed, false);
  assert.equal(decideDailyAiCall(users.get("user-b"), now).allowed, true);
});
