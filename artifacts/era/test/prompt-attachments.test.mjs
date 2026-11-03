import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAttachmentReadRequestFits,
  composePromptWithAttachments,
  compressImageForUpload,
  getScaledImageDimensions,
  getPromptAttachmentKind,
  getPromptAttachmentStorageKey,
  MAX_ATTACHMENT_READ_REQUEST_BYTES,
  preparePromptAttachmentContext,
  shouldAnswerQuestionAboutAttachments,
  validatePromptAttachmentSelection,
} from "../src/lib/prompt-attachments.ts";

function mockFile(name, size, type = "", text = "") {
  return {
    name,
    size,
    type,
    lastModified: 1,
    text: async () => text,
  };
}

test("recognizes supported photo, PDF, and text/code files", () => {
  assert.deepEqual(getPromptAttachmentKind(mockFile("photo.jpg", 10)), {
    kind: "binary",
    mimeType: "image/jpeg",
  });
  assert.deepEqual(getPromptAttachmentKind(mockFile("brief.pdf", 10)), {
    kind: "binary",
    mimeType: "application/pdf",
  });
  assert.deepEqual(getPromptAttachmentKind(mockFile("app.ts", 10, "text/plain")), { kind: "text" });
  assert.equal(getPromptAttachmentKind(mockFile("archive.zip", 10)), null);
});

test("validates the number and size of selected files", () => {
  assert.match(
    validatePromptAttachmentSelection(Array.from({ length: 5 }, (_, i) => mockFile(`${i}.txt`, 1))),
    /no more than 4/,
  );
  assert.match(validatePromptAttachmentSelection([mockFile("large.png", 4 * 1024 * 1024 + 1)]), /4 MB/);
  assert.match(validatePromptAttachmentSelection([mockFile("large.ts", 100 * 1024 + 1)]), /100 KB/);
  assert.equal(validatePromptAttachmentSelection([mockFile("notes.md", 100)]), null);
});

test("scales large images proportionally to the 1568px maximum", () => {
  assert.deepEqual(getScaledImageDimensions(4000, 2000), { width: 1568, height: 784 });
  assert.deepEqual(getScaledImageDimensions(800, 600), { width: 800, height: 600 });
});

test("compresses images before Base64 upload when the browser encoder reduces size", async () => {
  const originalCreateImageBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let canvasSize;
  let drawSize;
  let requestedType;
  const context = {
    drawImage(_source, _x, _y, width, height) { drawSize = { width, height }; },
    clearRect() {},
    fillRect() {},
    set fillStyle(_value) {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob(callback, type, quality) {
      requestedType = { type, quality };
      canvasSize = { width: this.width, height: this.height };
      callback(new Blob(["small"], { type }));
    },
  };
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => ({ width: 4000, height: 2000, close() {} }),
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => canvas },
  });

  try {
    const original = new Blob([new Uint8Array(4096)], { type: "image/jpeg" });
    const result = await compressImageForUpload(original, "image/jpeg");
    assert.equal(result.mimeType, "image/webp");
    assert.deepEqual(canvasSize, { width: 1568, height: 784 });
    assert.deepEqual(drawSize, { width: 1568, height: 784 });
    assert.deepEqual(requestedType, { type: "image/webp", quality: 0.82 });
    assert.equal(result.blob.size, 5);
  } finally {
    if (originalCreateImageBitmap) Object.defineProperty(globalThis, "createImageBitmap", originalCreateImageBitmap);
    else delete globalThis.createImageBitmap;
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else delete globalThis.document;
  }
});

test("rejects attachment request bodies that exceed the route parser limit", () => {
  assert.throws(
    () => assertAttachmentReadRequestFits(
      [{ fileName: "scan.pdf", mimeType: "application/pdf", data: "a".repeat(MAX_ATTACHMENT_READ_REQUEST_BYTES) }],
    ),
    /still too large/,
  );
});

test("reads text/code locally and skips the Gemini read call", async () => {
  let binaryReadCalls = 0;
  const result = await preparePromptAttachmentContext(
    [mockFile("requirements.md", 27, "text/markdown", "Build a small catalog.")],
    async () => {
      binaryReadCalls += 1;
      throw new Error("Text files must not trigger Gemini.");
    },
  );

  assert.equal(binaryReadCalls, 0);
  assert.equal(result.extraCredits, 0);
  assert.match(result.context, /requirements\.md/);
  assert.match(result.context, /Build a small catalog/);
});

test("an empty attachment selection produces no file context or read call", async () => {
  let binaryReadCalls = 0;
  const result = await preparePromptAttachmentContext([], async () => {
    binaryReadCalls += 1;
    throw new Error("No attachments should be read.");
  });

  assert.equal(binaryReadCalls, 0);
  assert.deepEqual(result, { context: "", extraCredits: 0 });
});

test("rejects oversized text context and combined prompts", async () => {
  await assert.rejects(
    preparePromptAttachmentContext(
      [mockFile("large.txt", 10, "text/plain", "a".repeat(6001))],
      async () => ({ context: "", creditsCharged: 0 }),
    ),
    /6,000 characters or fewer/,
  );
  assert.throws(
    () => composePromptWithAttachments("x".repeat(9990), "attached context"),
    /exceed 10,000 characters/,
  );
  assert.equal(composePromptWithAttachments("", "", "Use the attached files."), "Use the attached files.");
});

test("routes attachment questions to a direct answer, but preserves explicit build requests", () => {
  const files = [mockFile("screenshot.jpg", 10)];
  assert.equal(shouldAnswerQuestionAboutAttachments("What is this?", files), true);
  assert.equal(shouldAnswerQuestionAboutAttachments("Describe this image", files), true);
  assert.equal(shouldAnswerQuestionAboutAttachments("Eta ki?", files), true);
  assert.equal(shouldAnswerQuestionAboutAttachments("Create a social media website from this", files), false);
  assert.equal(shouldAnswerQuestionAboutAttachments("What is this? Please build a website like it.", files), false);
  assert.equal(shouldAnswerQuestionAboutAttachments("What is this?", []), false);
});

test("scopes persisted attachment keys by signed-in user and composer", () => {
  assert.equal(getPromptAttachmentStorageKey("user/1", "home"), "user:user%2F1:surface:home");
  assert.notEqual(
    getPromptAttachmentStorageKey("user/1", "home"),
    getPromptAttachmentStorageKey("user/2", "home"),
  );
  assert.notEqual(
    getPromptAttachmentStorageKey("user/1", "project:p1:build"),
    getPromptAttachmentStorageKey("user/1", "project:p1:plan"),
  );
  assert.equal(getPromptAttachmentStorageKey(null, "home"), null);
});
