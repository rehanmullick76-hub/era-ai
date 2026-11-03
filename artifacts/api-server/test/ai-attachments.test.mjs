import assert from "node:assert/strict";
import test from "node:test";
import { buildAttachmentReaderPrompts, decodeAiAttachments } from "../src/lib/ai-attachments.ts";

function encoded(fileName, mimeType, contents) {
  return { fileName, mimeType, data: Buffer.from(contents).toString("base64") };
}

test("accepts supported image and PDF data without retaining filesystem paths", () => {
  const files = decodeAiAttachments([
    encoded("../reference.jpg", "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03, 0x04])),
    encoded("brief.pdf", "application/pdf", "%PDF-1.4\nbody"),
  ]);

  assert.equal(files[0].fileName, ".._reference.jpg");
  assert.equal(files[0].mimeType, "image/jpeg");
  assert.equal(files[1].mimeType, "application/pdf");
  assert.equal(files[1].byteLength, Buffer.byteLength("%PDF-1.4\nbody"));
});

test("rejects unsupported types, invalid base64, and mismatched file signatures", () => {
  assert.throws(
    () => decodeAiAttachments([encoded("secret.txt", "text/plain", "text")]),
    /Only JPG, PNG, WebP, and PDF/,
  );
  assert.throws(
    () => decodeAiAttachments([{ fileName: "image.png", mimeType: "image/png", data: "not-base64!" }]),
    /could not be read/i,
  );
  assert.throws(
    () => decodeAiAttachments([encoded("image.png", "image/png", "not a png file")]),
    /does not match its declared type/,
  );
});

test("enforces per-file and aggregate attachment size limits", () => {
  const tooLarge = Buffer.alloc(4 * 1024 * 1024 + 1);
  tooLarge.set([0xff, 0xd8, 0xff]);
  assert.throws(
    () => decodeAiAttachments([encoded("large.jpg", "image/jpeg", tooLarge)]),
    /4 MB or smaller/,
  );

  const each = Buffer.alloc(2_800_000);
  each.set([0xff, 0xd8, 0xff]);
  assert.throws(
    () => decodeAiAttachments([
      encoded("one.jpg", "image/jpeg", each),
      encoded("two.jpg", "image/jpeg", each),
      encoded("three.jpg", "image/jpeg", each),
    ]),
    /8 MB or smaller/,
  );
});

test("attachment questions receive a direct answer prompt instead of a website-generation prompt", () => {
  const prompts = buildAttachmentReaderPrompts({
    question: "What is this?",
    referenceText: "[Attached text/code file: note.txt]\nA short note.",
    attachments: [{ fileName: "screenshot.jpg", mimeType: "image/jpeg" }],
  });

  assert.match(prompts.prompt, /User question:\nWhat is this\?/);
  assert.match(prompts.prompt, /screenshot\.jpg/);
  assert.match(prompts.prompt, /A short note/);
  assert.match(prompts.systemInstruction, /Answer the question directly/);
  assert.match(prompts.systemInstruction, /Do not create a website or app/);
});

test("attachment build context remains a factual summary when no question is supplied", () => {
  const prompts = buildAttachmentReaderPrompts({
    attachments: [{ fileName: "reference.pdf", mimeType: "application/pdf" }],
  });
  assert.match(prompts.prompt, /summarize relevant information/);
  assert.match(prompts.systemInstruction, /private attachment reader/);
});
