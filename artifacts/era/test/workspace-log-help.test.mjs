import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWorkspaceFixPrompt, explainWorkspaceLogs } from "../src/lib/workspace-log-help.ts";

test("explains a port conflict in plain language with a safe next step", () => {
  const help = explainWorkspaceLogs(
    "ERROR: Error listening on port\nlisten EADDRINUSE: address already in use 0.0.0.0:8080",
  );
  assert.match(help.title, /port is already in use/i);
  assert.match(help.nextStep, /Ask ERA.*rebuild/i);
});

test("recognizes missing packages and database connection errors", () => {
  assert.match(
    explainWorkspaceLogs("Error: Cannot find module 'express'").title,
    /package that is missing/i,
  );
  assert.match(
    explainWorkspaceLogs("Error: ECONNREFUSED database server").title,
    /could not connect to its database/i,
  );
});

test("recognizes code errors and timeouts", () => {
  assert.match(explainWorkspaceLogs("SyntaxError: Unexpected token").title, /code error/i);
  assert.match(explainWorkspaceLogs("ETIMEDOUT: request timed out").title, /too long to respond/i);
});

test("keeps unknown errors understandable without exposing raw log details in the summary", () => {
  const help = explainWorkspaceLogs("FATAL: unusual failure with private details");
  assert.match(help.title, /reported an error/i);
  assert.doesNotMatch(help.explanation, /private details/i);
  assert.match(help.nextStep, /Chat or Build/i);
});

test("does not show an old error after a later successful startup", () => {
  assert.equal(
    explainWorkspaceLogs("Error: Cannot find module 'express'\nServer listening and ready"),
    null,
  );
  assert.equal(explainWorkspaceLogs("Server listening and ready"), null);
});

test("Fix with ERA creates a draft and redacts credentials from recent logs", () => {
  const logs = [
    "old startup output",
    "GOOGLE_AI_API_KEY=AIza012345678901234567890123456789012345",
    "DATABASE_URL=postgresql://person:password@db.example/app",
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
    "Error: Cannot find module 'express'",
  ].join("\n");
  const prompt = buildWorkspaceFixPrompt(logs, explainWorkspaceLogs(logs));

  assert.match(prompt, /Fix the full-stack workspace error/i);
  assert.match(prompt, /secrets redacted/i);
  assert.match(prompt, /Cannot find module 'express'/);
  assert.doesNotMatch(prompt, /AIza012345678901234567890123456789012345/);
  assert.doesNotMatch(prompt, /person:password/);
  assert.doesNotMatch(prompt, /abcdefghijklmnopqrstuvwxyz/);
});
