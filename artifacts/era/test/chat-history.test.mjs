import assert from "node:assert/strict";
import test from "node:test";
import { buildHistorySnapshot } from "../src/lib/chat-history.ts";

test("keeps full context for only the two newest attachment messages", () => {
  const messages = Array.from({ length: 4 }, (_, index) => ({
    type: "user",
    content: `prompt ${index}`,
    hiddenContext: `context-${index}-` + "x".repeat(1_000),
  }));
  const history = buildHistorySnapshot(messages);
  const userContents = history.filter(entry => entry.role === "user").map(entry => entry.content);

  assert.equal(userContents.length, 4);
  for (const content of userContents.slice(0, 2)) {
    const hiddenContext = content.split("\n\n").at(-1);
    assert.equal(hiddenContext.length, 801);
    assert.ok(hiddenContext.endsWith("…"));
  }
  assert.ok(userContents[2].endsWith("x".repeat(1_000)));
  assert.ok(userContents[3].endsWith("x".repeat(1_000)));
});

test("trims oldest history first and never exceeds the 26,000 character budget", () => {
  const messages = Array.from({ length: 12 }, (_, index) => ({
    type: index % 2 === 0 ? "user" : "assistant",
    content: `${index === 11 ? "latest-message" : `message-${index}`}-` + "x".repeat(2_000),
    ...(index === 0 || index === 2 || index === 10
      ? { hiddenContext: `attachment-${index}-` + "y".repeat(6_000) }
      : {}),
  }));
  const history = buildHistorySnapshot(messages);

  assert.ok(history.reduce((total, entry) => total + entry.content.length, 0) <= 26_000);
  assert.ok(history.at(-1)?.content.includes("latest-message"));
  assert.ok(history.length <= 12);
});
