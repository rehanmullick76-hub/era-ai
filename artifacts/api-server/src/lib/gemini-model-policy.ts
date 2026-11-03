/** Only general-purpose Gemini text models belong in ERA's code/chat chain. */
export interface ApiModel {
  name: string;
  supportedGenerationMethods?: string[];
  outputTokenLimit?: number;
}

export interface RankedModel {
  name: string;
  score: number;
  outputTokenLimit: number;
}

export const STATIC_MODEL_CHAIN = [
  "gemini-4-argon",
  "gemini-3.1-pro-preview",
  "gemini-2.5-pro",
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite",
] as const;

function family(name: string): number {
  if (/-argon(?:-|$)/.test(name)) return 4;
  if (/-pro(?:-|$)/.test(name)) return 3;
  if (/-flash-(?:lite|8b)(?:-|$)/.test(name)) return 1;
  return 2;
}

export function rankTextModels(models: ApiModel[]): RankedModel[] {
  const candidates = models.filter(model =>
    model.supportedGenerationMethods?.includes("generateContent") &&
    // Positive grammar excludes new specialist variants by default, even when
    // they claim generateContent support (TTS, images, customtools, robotics...).
    /^models\/gemini-(?:(?:\d+(?:\.\d+)?-)?(?:pro|flash(?:-(?:lite|8b))?|argon))(?:-(?:latest|preview|exp|thinking|\d{2,4}))*$/.test(model.name),
  );
  const concreteFamilies = new Set(candidates
    .filter(model => /^models\/gemini-\d/.test(model.name))
    .map(model => family(model.name)));
  return [...new Map(candidates
    // Avoid spending another request on a latest alias of a concrete model.
    .filter(model => !model.name.endsWith("-latest") || !concreteFamilies.has(family(model.name)))
    .map(model => {
      const name = model.name.replace(/^models\//, "");
      const version = name.match(/^gemini-(\d+)(?:\.(\d+))?-/);
      const score = family(name) * 1_000_000 +
        Number(version?.[1] ?? 0) * 10_000 + Number(version?.[2] ?? 0) * 100 -
        (/preview|exp/.test(name) ? 10 : 0);
      return [name, { name, score, outputTokenLimit: model.outputTokenLimit || 8192 }] as const;
    })).values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export function providerStatus(error: unknown): number | undefined {
  const e = error as { status?: number; code?: number } | null;
  return e?.status ?? e?.code;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // SDK errors often put google.rpc.QuotaFailure / RetryInfo inside a JSON message.
  return message;
}

export function isQuotaError(error: unknown): boolean {
  return providerStatus(error) === 429 ||
    /\b429\b|RESOURCE_EXHAUSTED|quota\s+(?:exceeded|exhausted)/i.test(errorText(error));
}

export function isDailyQuotaError(error: unknown): boolean {
  return /limit["']?\s*:\s*0\b|per.?day|daily|tokensperday|requestsperday/i.test(errorText(error));
}

/** Gemini RPD resets at midnight America/Los_Angeles, including DST changes. */
export function nextDailyQuotaReset(now: number): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const localAsUtc = (time: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(time).map(p => [p.type, p.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  };
  const local = new Date(localAsUtc(now));
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  let reset = midnight;
  for (let i = 0; i < 3; i++) reset = midnight - (localAsUtc(reset) - reset);
  return reset;
}

function quotaCooldown(error: unknown, now: number): number {
  if (isDailyQuotaError(error)) return nextDailyQuotaReset(now);
  const text = errorText(error);
  const seconds = text.match(/(?:retryDelay["']?\s*:\s*["']?|retry in\s+)(\d+(?:\.\d+)?)s/i);
  return now + Math.max(1000, Math.min(3600_000, seconds ? Number(seconds[1]) * 1000 + 1000 : 60_000));
}

interface BlockedModel {
  until: number;
  quota: boolean;
  daily: boolean;
}

export class GeminiDeadlineError extends Error {
  constructor() {
    super("Gemini is taking too long to respond. Please try again shortly; this failed request will not use credits.");
    this.name = "GeminiDeadlineError";
  }
}

export class GeminiModelTimeoutError extends Error {
  constructor() {
    super("Gemini model request timed out");
    this.name = "GeminiModelTimeoutError";
  }
}

export function modelRequestTimeouts(attemptMs: number, remainingMs: number): {
  localTimeoutMs: number; providerTimeoutMs: number;
} {
  if (remainingMs <= 0) throw new GeminiDeadlineError();
  const localTimeoutMs = Math.min(attemptMs, remainingMs);
  // Google's server timeout header must be >=10s, even when our own budget has
  // less time left. The independent local abort still enforces that budget.
  return { localTimeoutMs, providerTimeoutMs: Math.max(10_000, localTimeoutMs) };
}

export function fallbackDeadline(deadline: number | undefined, now: number): number {
  // An explicit generation budget must not be silently shortened to the
  // default budget intended for smaller chat/helper operations.
  return deadline ?? now + 75_000;
}

export function attemptBudget(model: string, normalMs: number, lightweightMs?: number): number {
  return lightweightMs && /-flash-(?:lite|8b)(?:-|$)/i.test(model) ? lightweightMs : normalMs;
}

/** The outer timer also bounds SDK/transport code that fails to honor abort. */
export async function withModelTimeout<T>(
  timeoutMs: number,
  invoke: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => invoke(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new GeminiModelTimeoutError());
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Shared across requests and pipeline stages in this API process. Each attempt
 * receives the caller's original prompt/history; no partial output is appended.
 */
export class ModelFallbackRouter {
  private blocked = new Map<string, BlockedModel>();
  private now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async run<T>(
    chain: readonly string[],
    invoke: (model: string) => Promise<T>,
    options: {
      isFatal: (error: unknown) => boolean;
      quotaError: (daily: boolean) => Error;
      deadline?: number;
      fastFallbackWindowMs?: number;
      onFallback?: (model: string, reason: string, details?: { status?: number; localTimeout: boolean }) => void | Promise<void>;
    },
  ): Promise<T> {
    let lastError: unknown;
    let allQuota = true;
    let allDaily = true;
    const unique = [...new Set(chain)];
    if (unique.length === 0) throw new Error("No suitable Gemini text models are available.");
    for (let index = 0; index < unique.length; index++) {
      if (options.deadline !== undefined && this.now() >= options.deadline) {
        throw new GeminiDeadlineError();
      }
      // Keep best-first while there is time, but reserve the final window for
      // an available lightweight model instead of exhausting the budget on
      // several similar overloaded Flash versions.
      if (options.deadline !== undefined && options.fastFallbackWindowMs &&
          options.deadline - this.now() <= options.fastFallbackWindowMs) {
        const fastIndex = unique.findIndex((candidate, candidateIndex) =>
          candidateIndex >= index && /-flash-(?:lite|8b)(?:-|$)/i.test(candidate) &&
          (this.blocked.get(candidate)?.until ?? 0) <= this.now(),
        );
        if (fastIndex > index) {
          const [fast] = unique.splice(fastIndex, 1);
          unique.splice(index, 0, fast);
          await options.onFallback?.(fast, "reserved-fast-fallback-window");
        }
      }
      const model = unique[index];
      const blocked = this.blocked.get(model);
      if (blocked && blocked.until > this.now()) {
        allQuota &&= blocked.quota;
        allDaily &&= blocked.daily;
        await options.onFallback?.(model, "cooldown");
        continue;
      }
      this.blocked.delete(model);
      try {
        return await invoke(model);
      } catch (error) {
        if (options.isFatal(error)) throw error;
        lastError = error;
        if (isQuotaError(error)) {
          const daily = isDailyQuotaError(error);
          allDaily &&= daily;
          this.blocked.set(model, { until: quotaCooldown(error, this.now()), quota: true, daily });
          await options.onFallback?.(model, daily ? "daily-quota" : "rate-limit");
        } else {
          allQuota = false;
          allDaily = false;
          const status = providerStatus(error) ?? 0;
          // Busy/slow models must also be skipped by subsequent pipeline passes,
          // rather than multiplying their timeouts across selector/design/code.
          if ([403, 404].includes(status) || status >= 500 || error instanceof GeminiModelTimeoutError) {
            this.blocked.set(model, {
              until: this.now() + ([403, 404].includes(status) ? 5 * 60_000 : 2 * 60_000),
              quota: false, daily: false,
            });
          }
          await options.onFallback?.(model, "provider-error", {
            status: providerStatus(error), localTimeout: error instanceof GeminiModelTimeoutError,
          });
        }
      }
    }
    if (allQuota) throw options.quotaError(allDaily);
    if (lastError instanceof GeminiModelTimeoutError) throw new GeminiDeadlineError();
    throw lastError ?? new Error("No Gemini model is currently available. Please try again later.");
  }
}
