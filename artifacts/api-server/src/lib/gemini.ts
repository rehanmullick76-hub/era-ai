import { GoogleGenAI, type Content } from "@google/genai";
import { logger } from "./logger";
import { readTokenUsage } from "./token-billing";
import { QuotaExhaustedError } from "./aiRouteErrors";
import {
  isGoogleSearchCapabilityError,
  normalizeGoogleSearchSources,
  GoogleSearchUnavailableError,
  type GoogleSearchSource,
} from "./ai-search";
import {
  isQuotaError, ModelFallbackRouter, providerStatus, rankTextModels, STATIC_MODEL_CHAIN,
  GeminiDeadlineError, GeminiModelTimeoutError, withModelTimeout,
  modelRequestTimeouts, fallbackDeadline, attemptBudget,
  type ApiModel, type RankedModel,
} from "./gemini-model-policy";

function getGenAI(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY environment variable is not set");
  return new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
}

// ── Dynamic model discovery ───────────────────────────────────────────────

let _cachedModels: RankedModel[] | null = null;
let _cacheExpiry = 0;
let _discovery: Promise<RankedModel[]> | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000;
const modelRouter = new ModelFallbackRouter();

async function fetchModelsFromApi(): Promise<RankedModel[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return [];
  try {
    const models: ApiModel[] = [];
    let pageToken: string | undefined;
    const seen = new Set<string>();
    const signal = AbortSignal.timeout(15_000);
    do {
      const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url, { headers: { "x-goog-api-key": apiKey }, signal });
      if (!res.ok) {
        logger.warn({ status: res.status }, "Gemini model discovery failed");
        return [];
      }
      const data = await res.json() as { models?: ApiModel[]; nextPageToken?: string };
      models.push(...(data.models ?? []));
      pageToken = data.nextPageToken;
      if (pageToken && seen.has(pageToken)) throw new Error("Repeated model-list page token");
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    return rankTextModels(models);
  } catch {
    // Do not log the fetch error: transport errors may contain credentials.
    logger.warn("Failed to fetch Gemini model list, using cached/static fallback");
    return [];
  }
}

async function getDiscoveredModels(): Promise<RankedModel[]> {
  if (_cachedModels && Date.now() < _cacheExpiry) return _cachedModels;
  if (!_discovery) {
    _discovery = (async () => {
      const models = await fetchModelsFromApi();
      _cachedModels = models.length > 0 ? models : (_cachedModels ?? []);
      _cacheExpiry = Date.now() + (models.length > 0 ? CACHE_TTL_MS : 60_000);
      logger.info({ chain: _cachedModels.map(m => m.name) }, "Gemini best-first text model chain");
      return _cachedModels;
    })().finally(() => { _discovery = null; });
  }
  return _discovery;
}

// ── Static fallback (used when API discovery fails) ────────────────────────

export type TaskType = "coding" | "testing" | "design";

/**
 * Return an ordered model chain for a given task.
 *
 * All tasks use the same capability-first policy. Quota cooldowns are applied
 * when each call actually runs, including chains obtained earlier in a job.
 */
export async function getModelChain(_task: TaskType): Promise<string[]> {
  const models = await getDiscoveredModels();

  return models.length > 0 ? models.map(m => m.name) : [...STATIC_MODEL_CHAIN];
}

/**
 * Generation and its selector/design/repair passes share the same policy.
 */
export async function getGenerationModelChain(): Promise<string[]> {
  return getModelChain("coding");
}

// ── Core generation helpers ────────────────────────────────────────────────

export type GeminiMessage = Content;
export interface GeminiTokenUsage {
  inputTokens: number;
  outputTokens: number;
}
export interface GeminiRequestOptions {
  timeoutMs?: number;
  lightweightTimeoutMs?: number;
  fastFallbackWindowMs?: number;
  maxOutputTokens?: number;
  inlineData?: { mimeType: string; data: string }[];
  /** Shared absolute deadline across all stages of one generation job. */
  deadline?: number;
  /** Safe user-facing stage updates for a persisted generation job. */
  stage?: "design" | "code" | "repair";
  onProgress?: (stage: "design" | "code" | "repair" | "fallback", model: string) => void | Promise<void>;
  googleSearch?: boolean;
}
export class GeminiTokenUsageError extends Error {
  constructor(message = "Gemini did not return token usage. Please retry the generation.") {
    super(message);
    this.name = "GeminiTokenUsageError";
  }
}

export function toGeminiHistory(
  history: { role: string; content: string }[],
): GeminiMessage[] {
  return history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

async function callModel(
  modelId: string,
  prompt: string,
  history: GeminiMessage[],
  systemInstruction?: string,
  onUsage?: (usage: GeminiTokenUsage) => void,
  options: GeminiRequestOptions = {},
): Promise<{ text: string; groundingSources: GoogleSearchSource[] }> {
  const remaining = (options.deadline ?? Date.now() + 75_000) - Date.now();
  const { localTimeoutMs: timeoutMs, providerTimeoutMs } =
    modelRequestTimeouts(attemptBudget(modelId, options.timeoutMs ?? 15_000, options.lightweightTimeoutMs), remaining);
  logger.info({ modelId, timeoutMs }, "Gemini request started");
  const started = Date.now();
  const response = await withModelTimeout(timeoutMs, abortSignal => getGenAI().models.generateContent({
    model: modelId,
    contents: [
      ...history,
      {
        role: "user",
        parts: [
          { text: prompt },
          ...(options.inlineData ?? []).map(inlineData => ({ inlineData })),
        ],
      },
    ],
    config: {
      abortSignal,
      httpOptions: { timeout: providerTimeoutMs, retryOptions: { attempts: 1 } },
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(options.googleSearch ? { tools: [{ googleSearch: {} }] } : {}),
      maxOutputTokens: Math.min(options.maxOutputTokens ?? 8192,
        _cachedModels?.find(m => m.name === modelId)?.outputTokenLimit ??
        (modelId.includes("argon") ? 32768 : 65536)),
      // Avoid spending a large default reasoning budget on small helper replies.
      ...(/^gemini-2\.5-/.test(modelId) ? {
        thinkingConfig: { thinkingBudget: (options.maxOutputTokens ?? 8192) > 8192
          ? 1024 : modelId.includes("flash") ? 0 : 128 },
      } : {}),
    },
  }));
  logger.info({ modelId, elapsedMs: Date.now() - started }, "Gemini response received");
  if (onUsage) {
    try {
      onUsage(readTokenUsage(response.usageMetadata));
    } catch (err) {
      throw new GeminiTokenUsageError(err instanceof Error ? err.message : undefined);
    }
  }
  if (!response.text?.trim()) {
    throw new Error("Gemini returned an empty response");
  }
  return {
    text: response.text,
    groundingSources: options.googleSearch
      ? normalizeGoogleSearchSources(response.candidates?.[0]?.groundingMetadata?.groundingChunks)
      : [],
  };
}

/**
 * SDK retries are disabled. Quota, overload and timeout immediately fall back
 * to a different model instead of repeating a multi-second failing request.
 */
export async function generateWithRetry(
  modelId: string,
  prompt: string,
  history: GeminiMessage[] = [],
  systemInstruction?: string,
  maxRetries = 0,
  onUsage?: (usage: GeminiTokenUsage) => void,
  options: GeminiRequestOptions = {},
): Promise<{ text: string; groundingSources: GoogleSearchSource[] }> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callModel(modelId, prompt, history, systemInstruction, onUsage, options);
    } catch (err) {
      lastError = err;
      if (err instanceof GeminiTokenUsageError) throw err;
      if (err instanceof GeminiDeadlineError || err instanceof GeminiModelTimeoutError) throw err;
      if (isQuotaError(err)) throw err;
      const status = providerStatus(err);
      if (status && status >= 500) throw err;
      if (status && status < 500 && status !== 408) throw err;
      logger.warn({ status, attempt, modelId }, "Gemini transient error, retrying");
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastError;
}

/**
 * Immediately retry the same request/context on the next available model.
 * Quota-hit models are skipped by later pipeline stages until their reset.
 */
export async function generateWithFallback(
  prompt: string,
  history: GeminiMessage[] = [],
  systemInstruction: string | undefined,
  modelChain: readonly string[],
  onUsage?: (usage: GeminiTokenUsage) => void,
  options: GeminiRequestOptions = {},
): Promise<{ text: string; model: string; groundingSources: GoogleSearchSource[] }> {
  const bounded = { ...options, deadline: fallbackDeadline(options.deadline, Date.now()) };
  let fallbackStarted = false;
  try {
    return await modelRouter.run(modelChain, async modelId => {
      await options.onProgress?.(fallbackStarted ? "fallback" : options.stage ?? "code", modelId);
      const result = await generateWithRetry(modelId, prompt, history, systemInstruction, 0, onUsage, bounded);
      logger.info({ modelId }, "Gemini request completed");
      return { ...result, model: modelId };
    }, {
      deadline: bounded.deadline,
      fastFallbackWindowMs: options.fastFallbackWindowMs ?? 20_000,
      isFatal: err => err instanceof GeminiTokenUsageError || err instanceof GeminiDeadlineError || providerStatus(err) === 401,
      quotaError: daily => new QuotaExhaustedError(daily ? undefined :
        "All available Gemini models are temporarily rate-limited. Please try again shortly."),
      onFallback: async (modelId, reason, details) => {
        fallbackStarted = true;
        logger.warn({ modelId, reason, ...details }, "Gemini model skipped; trying next model");
        await options.onProgress?.("fallback", "");
      },
    });
  } catch (error) {
    if (options.googleSearch && isGoogleSearchCapabilityError(error)) {
      throw new GoogleSearchUnavailableError();
    }
    throw error;
  }
}
