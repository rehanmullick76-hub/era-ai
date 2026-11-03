import assert from "node:assert/strict";
import { test } from "node:test";
import { FULLSTACK_SYSTEM } from "../src/lib/fullstack-prompt.ts";

test("demo records are generated through the database-backed app, not migrations or mock data", () => {
  assert.match(FULLSTACK_SYSTEM, /Demo\/sample records must be real database-backed records/);
  assert.match(FULLSTACK_SYSTEM, /never migration SQL or fake frontend data/);
  assert.match(FULLSTACK_SYSTEM, /never rewrite or delete an existing migration/);
  assert.match(FULLSTACK_SYSTEM, /additive DDL only when a schema change is required/);
});
