import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getAiRouteFailure,
  QuotaExhaustedError,
} from "../src/lib/aiRouteErrors.ts";

test("shared Gemini quota exhaustion remains a distinct 429 with its original message", () => {
  const error = new QuotaExhaustedError();

  assert.deepEqual(getAiRouteFailure(error, "Route fallback."), {
    status: 429,
    message: error.message,
  });
});

test("ordinary provider or route failures keep the endpoint-specific 500 message", () => {
  assert.deepEqual(
    getAiRouteFailure(new Error("Connection reset"), "Failed to create a plan."),
    { status: 500, message: "Failed to create a plan." },
  );
});

test("response deadlines reach the user rather than becoming an unexplained generic error", () => {
  const error = Object.assign(new Error("Gemini is taking too long. Please retry."), {
    name: "GeminiDeadlineError",
  });
  assert.deepEqual(getAiRouteFailure(error, "Failed to create a plan."), {
    status: 500, message: error.message,
  });
});

test("unavailable live search is reported clearly and distinctly", () => {
  const error = Object.assign(
    new Error("ERA couldn't retrieve live web sources for this request."),
    { name: "GoogleSearchUnavailableError" },
  );
  assert.deepEqual(getAiRouteFailure(error, "Failed to create a plan."), {
    status: 503,
    message: error.message,
  });
});
