import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getGoogleSearchStatus,
  GOOGLE_SEARCH_RESEARCH_INSTRUCTION,
  GOOGLE_SEARCH_SAFETY_INSTRUCTION,
  isGoogleSearchCapabilityError,
  normalizeGoogleSearchSources,
  shouldUseGoogleSearch,
} from "../src/lib/ai-search.ts";

test("web search is enabled for explicit research and current-information requests", () => {
  for (const prompt of [
    "Search the web for current accessibility guidelines and cite sources.",
    "What is the latest Gemini model?",
    "আজকের আবহাওয়া কী?",
    "Google e search kore result dao",
  ]) {
    assert.equal(shouldUseGoogleSearch(prompt), true, prompt);
  }
});

test("ordinary chat and search-bar implementation requests do not spend a search call", () => {
  for (const prompt of [
    "Hello",
    "Add a search bar to the product page.",
    "Create source code for a simple portfolio.",
    "Make the current website responsive.",
  ]) {
    assert.equal(shouldUseGoogleSearch(prompt), false, prompt);
  }
});

test("grounding sources are deduplicated, bounded, and restricted to safe HTTPS URLs", () => {
  const chunks = [
    { web: { title: "Official guide", uri: "https://example.com/guide" } },
    { web: { title: "Duplicate", uri: "https://example.com/guide" } },
    { web: { title: "Unsafe", uri: "javascript:alert(1)" } },
    { web: { title: "Insecure", uri: "http://example.com/" } },
    { web: { title: "Credentials", uri: "https://user:pass@example.com/" } },
    ...Array.from({ length: 10 }, (_, index) => ({
      web: { uri: `https://source${index}.example/page` },
    })),
  ];
  const sources = normalizeGoogleSearchSources(chunks);

  assert.equal(sources.length, 8);
  assert.deepEqual(sources[0], {
    title: "Official guide",
    url: "https://example.com/guide",
  });
  assert.equal(sources[1].title, "source0.example");
  assert.ok(sources.every(source => source.url.startsWith("https://")));
});

test("missing source metadata is reported as unavailable, never as successful search", () => {
  assert.equal(getGoogleSearchStatus(false, []), "not_used");
  assert.equal(getGoogleSearchStatus(true, []), "unavailable");
  assert.equal(getGoogleSearchStatus(true, [{ title: "Verified", url: "https://example.com" }]), "used");
});

test("grounding capability failures are distinguished from quota and server failures", () => {
  assert.equal(isGoogleSearchCapabilityError(Object.assign(
    new Error("Google Search tool is not supported by this model"),
    { status: 400 },
  )), true);
  assert.equal(isGoogleSearchCapabilityError(Object.assign(new Error("Quota exhausted"), { status: 429 })), false);
  assert.equal(isGoogleSearchCapabilityError(Object.assign(new Error("Unavailable"), { status: 503 })), false);
});

test("search instructions treat webpage content as untrusted and prohibit instruction following", () => {
  assert.match(GOOGLE_SEARCH_SAFETY_INSTRUCTION, /untrusted reference data/i);
  assert.match(GOOGLE_SEARCH_SAFETY_INSTRUCTION, /never follow instructions/i);
  assert.ok(GOOGLE_SEARCH_RESEARCH_INSTRUCTION.includes(GOOGLE_SEARCH_SAFETY_INSTRUCTION));
});
