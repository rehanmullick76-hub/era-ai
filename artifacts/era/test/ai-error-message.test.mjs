import assert from "node:assert/strict";
import { test } from "node:test";
import { getAiFailureMessage } from "../src/lib/ai-error-message.ts";

test("the per-user daily limit shows its own try-tomorrow message", () => {
  assert.equal(
    getAiFailureMessage(
      { status: 429, data: { error: "Daily AI call limit reached. Try again tomorrow." } },
      "Fallback.",
    ),
    "Daily AI call limit reached. Try again tomorrow.",
  );
});

test("shared Gemini quota exhaustion explains the provider limit", () => {
  assert.equal(
    getAiFailureMessage(
      { status: 429, data: { error: "All Gemini models have exhausted their daily quota." } },
      "Fallback.",
    ),
    "All Gemini models have exhausted their daily quota.",
  );
});

test("plan and generation preserve safe API errors instead of hiding the cause", () => {
  for (const message of [
    "Add a SQL migration in migrations/.",
    "Gemini took too long. Please try again.",
    "Failed to create plan. Please try again.",
  ]) {
    assert.equal(getAiFailureMessage({ status: 500, data: { error: message } }, "Fallback."), message);
  }
  assert.equal(getAiFailureMessage(new Error("Raw transport error"), "Fallback."), "Fallback.");
  assert.equal(getAiFailureMessage({ status: 500, data: { error: "" } }, "Fallback."), "Fallback.");
});

test("non-quota errors continue to use their normal client messages", () => {
  assert.equal(
    getAiFailureMessage({ status: 402 }, "Fallback."),
    "Out of credits, please add more.",
  );
  assert.equal(
    getAiFailureMessage({ status: 500 }, "Fallback."),
    "Fallback.",
  );
});
