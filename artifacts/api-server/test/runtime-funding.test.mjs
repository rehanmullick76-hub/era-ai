import test from "node:test";
import assert from "node:assert/strict";
import {runtimeProvidersConfigured} from "../src/lib/runtime-funding.ts";
test("full-stack generation stays selectable when both runtime providers are configured",()=>{
  assert.equal(runtimeProvidersConfigured("daytona-test-key","neon-test-key"),true);
  assert.equal(runtimeProvidersConfigured("daytona-test-key",""),false);
  assert.equal(runtimeProvidersConfigured("","neon-test-key"),false);
});
