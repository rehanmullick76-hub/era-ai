import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const FUNDING_CONSENT_FILE = "era-runtime-funding.json";
export const FUNDING_CONSENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export function runtimeProvidersConfigured(daytonaApiKey: string, neonApiKey: string): boolean {
  return Boolean(daytonaApiKey && neonApiKey);
}
