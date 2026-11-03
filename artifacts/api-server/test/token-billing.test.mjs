import assert from "node:assert/strict";
import { test } from "node:test";
import {
  creditAdjustmentForUsage,
  creditsForTokenUsage,
  readTokenUsage,
  settleCreditUsage,
} from "../src/lib/token-billing.ts";

test("generation credits use the configured weighted input and output rates", () => {
  assert.equal(creditsForTokenUsage({ inputTokens: 5_000, outputTokens: 2_000 }), 9);
  assert.equal(creditsForTokenUsage({ inputTokens: 1_000, outputTokens: 500 }), 2);
});

test("small token usage rounds up to one credit and empty usage costs zero", () => {
  assert.equal(creditsForTokenUsage({ inputTokens: 1, outputTokens: 1 }), 1);
  assert.equal(creditsForTokenUsage({ inputTokens: 0, outputTokens: 0 }), 0);
});

test("settlement calculates additional charges and refunds against the temporary reserve", () => {
  assert.equal(creditAdjustmentForUsage({ inputTokens: 5_000, outputTokens: 2_000 }, 5), 4);
  assert.equal(creditAdjustmentForUsage({ inputTokens: 1_000, outputTokens: 500 }, 5), -3);
});

test("completed generation charges only the available balance instead of being discarded", () => {
  assert.deepEqual(settleCreditUsage(
    { inputTokens: 5_000, outputTokens: 2_000 },
    1,
    2,
  ), {
    additionalCharge: 2,
    refund: 0,
    creditsCharged: 3,
    creditsRemaining: 0,
  });
});

test("credit settlement refunds unused reservation and keeps the exact token charge", () => {
  assert.deepEqual(settleCreditUsage(
    { inputTokens: 1_000, outputTokens: 0 },
    4,
    6,
  ), {
    additionalCharge: 0,
    refund: 3,
    creditsCharged: 1,
    creditsRemaining: 9,
  });
});

test("provider token usage must be present and valid", () => {
  assert.deepEqual(readTokenUsage({ promptTokenCount: 10, candidatesTokenCount: 5 }), {
    inputTokens: 10,
    outputTokens: 5,
  });
  assert.throws(() => readTokenUsage(undefined), /did not return token usage/);
  assert.throws(() => readTokenUsage({ promptTokenCount: -1, candidatesTokenCount: 2 }), /invalid token usage/);
});
