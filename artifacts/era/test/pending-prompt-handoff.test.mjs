import assert from "node:assert/strict";
import test from "node:test";
import { schedulePendingPromptSend } from "../src/lib/pending-prompt-handoff.ts";

function makeTimer() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    callbacks,
    schedule(callback, delayMs) {
      assert.equal(delayMs, 300);
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) {
      callbacks.delete(id);
    },
    fireNext() {
      const [id, callback] = callbacks.entries().next().value ?? [];
      if (!callback) return;
      callbacks.delete(id);
      callback();
    },
  };
}

test("a rerender cancellation keeps the prompt pending for the next send attempt", () => {
  const timer = makeTimer();
  const sentPrompts = [];
  let pendingPrompt = "Build a small shop";
  const sendPendingPrompt = () => {
    sentPrompts.push(pendingPrompt);
    pendingPrompt = "";
  };

  const cancelFirstAttempt = schedulePendingPromptSend(sendPendingPrompt, timer);
  cancelFirstAttempt();

  assert.equal(pendingPrompt, "Build a small shop");
  assert.equal(sentPrompts.length, 0);
  assert.equal(timer.callbacks.size, 0);

  const cancelSecondAttempt = schedulePendingPromptSend(sendPendingPrompt, timer);
  timer.fireNext();
  cancelSecondAttempt();

  assert.equal(pendingPrompt, "");
  assert.deepEqual(sentPrompts, ["Build a small shop"]);
});
