import assert from "node:assert/strict";
import { test } from "node:test";
import { rejectLegacyGuestAuthentication } from "../src/lib/legacy-guest-auth.ts";

test("legacy guest authentication returns a permanent sign-in-required response", () => {
  let statusCode;
  let body;
  const response = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  rejectLegacyGuestAuthentication({}, response);
  assert.equal(statusCode, 410);
  assert.deepEqual(body, { error: "Guest sessions are disabled. Please sign in." });
});
