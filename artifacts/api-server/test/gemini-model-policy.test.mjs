import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isQuotaError, ModelFallbackRouter, nextDailyQuotaReset, rankTextModels,
  GeminiDeadlineError, GeminiModelTimeoutError, withModelTimeout,
  modelRequestTimeouts, fallbackDeadline, attemptBudget,
} from "../src/lib/gemini-model-policy.ts";

const apiModel = (name, outputTokenLimit = 65536) => ({
  name: `models/${name}`, outputTokenLimit, supportedGenerationMethods: ["generateContent"],
});
const quota = (message = "RequestsPerDay quota exceeded") =>
  Object.assign(new Error(message), { status: 429 });
const options = {
  isFatal: () => false,
  quotaError: daily => Object.assign(new Error(daily ? "daily" : "temporary"), { quota: true }),
};

test("code generation retains its explicit budget and gives Lite enough output time", () => {
  assert.equal(fallbackDeadline(150000, 15000),150000);
  assert.equal(fallbackDeadline(undefined, 15000),90000);
  assert.equal(attemptBudget("gemini-3.5-flash-lite",20000,60000),60000);
  assert.equal(attemptBudget("gemini-2.5-pro",20000,60000),20000);
  assert.equal(attemptBudget("gemini-3.5-flash-lite",10000),10000);
});

test("cold generation reaches Lite with a full minute, after best-first attempts", async () => {
  let now=15000; // time already spent on optional design
  const router=new ModelFallbackRouter(()=>now);
  const calls=[];
  const result=await router.run(["pro","flash-a","flash-b","flash-c","gemini-3.5-flash-lite"],
    async model=>{
      calls.push(model);
      if(model.includes("lite")){
        assert.ok(150000-now>=60000);
        now+=50000; // realistic long code response, not a small helper reply
        return "complete source";
      }
      now+=20000;
      throw new GeminiModelTimeoutError();
    },{...options,deadline:150000,fastFallbackWindowMs:80000});
  assert.equal(result,"complete source");
  assert.deepEqual(calls,["pro","flash-a","flash-b","gemini-3.5-flash-lite"]);
});

test("fallback diagnostics distinguish HTTP errors from local timeout without logging payloads", async()=>{
  const events=[];
  await new ModelFallbackRouter().run(["http","timeout","ok"],async model=>{
    if(model==="http")throw Object.assign(new Error("private provider payload"),{status:503});
    if(model==="timeout")throw new GeminiModelTimeoutError();
    return "ok";
  },{...options,onFallback:(model,reason,details)=>events.push({model,reason,details})});
  assert.equal(events[0].details.status,503);
  assert.equal(events[1].details.localTimeout,true);
  assert.ok(!JSON.stringify(events).includes("private provider payload"));
});

test("fallback progress persistence finishes before the next model is attempted", async () => {
  const events = [];
  const result = await new ModelFallbackRouter().run(["unavailable", "available"], async model => {
    events.push(`attempt:${model}`);
    if (model === "unavailable") throw Object.assign(new Error("busy"), { status: 503 });
    assert.deepEqual(events, [
      "attempt:unavailable",
      "fallback-start",
      "fallback-finished",
      "attempt:available",
    ]);
    return "ok";
  }, {
    ...options,
    onFallback: async () => {
      events.push("fallback-start");
      await Promise.resolve();
      events.push("fallback-finished");
    },
  });
  assert.equal(result, "ok");
});

test("API models rank flagship, newer Pro, older Pro, Flash, Lite rather than cheapest first", () => {
  const names = [
    "gemini-2.5-flash-lite", "gemini-2.5-pro", "gemini-3.8-flash",
    "gemini-3.1-pro-preview", "gemini-4-argon", "gemini-3.5-flash-lite",
  ];
  assert.deepEqual(rankTextModels(names.map(n => apiModel(n))).map(m => m.name), [
    "gemini-4-argon", "gemini-3.1-pro-preview", "gemini-2.5-pro",
    "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite",
  ]);
});

test("non-text and specialist generateContent models never enter the code chain", () => {
  const names = [
    "gemini-3-pro-image", "gemini-2.5-pro-preview-tts", "gemini-3.1-pro-preview-customtools",
    "gemini-3.5-transcribe", "gemini-robotics-er-2-preview", "gemini-omni-flash-preview",
    "gemini-nano-banana-2.1", "lyria-3-pro-preview", "gemma-4-31b-it",
    "antigravity-preview-latest", "deep-research-pro-preview-12-2025",
  ];
  assert.deepEqual(rankTextModels(names.map(n => apiModel(n))), []);
  assert.deepEqual(rankTextModels([{ name: "models/gemini-2.5-pro", supportedGenerationMethods: ["embedContent"] }]), []);
});

test("stable versions beat preview twins, duplicate names and latest aliases are removed", () => {
  const names = ["gemini-3.1-pro-preview", "gemini-3.1-pro", "gemini-pro-latest", "gemini-3.1-pro"];
  assert.deepEqual(rankTextModels(names.map(n => apiModel(n))).map(m => m.name), [
    "gemini-3.1-pro", "gemini-3.1-pro-preview",
  ]);
  assert.equal(rankTextModels([apiModel("gemini-pro-latest")])[0].name, "gemini-pro-latest");
});

test("discovery keeps each model's output token limit", () => {
  assert.equal(rankTextModels([apiModel("gemini-4-argon", 32768)])[0].outputTokenLimit, 32768);
});

test("first available best model succeeds without calling lower ranked models", async () => {
  const router = new ModelFallbackRouter();
  const calls = [];
  assert.equal(await router.run(["best", "next"], async model => {
    calls.push(model);
    return model;
  }, options), "best");
  assert.deepEqual(calls, ["best"]);
});

test("quota failure retries immediately with identical job context and tracks the successful model", async () => {
  const router = new ModelFallbackRouter();
  const calls = [];
  const prompt = "Update existing files";
  const history = [{ role: "user", parts: [{ text: "Earlier context" }] }];
  const invoke = async model => {
    calls.push({ model, prompt, history });
    if (model === "best") throw quota();
    return { text: "complete output", model };
  };
  assert.deepEqual(await router.run(["best", "next"], invoke, options), {
    text: "complete output", model: "next",
  });
  assert.deepEqual(calls.map(c => c.model), ["best", "next"]);
  assert.equal(calls[0].history, calls[1].history);
  assert.equal(calls[0].prompt, calls[1].prompt);
});

test("later pipeline steps and other users skip daily-exhausted models until Pacific reset", async () => {
  let now = Date.parse("2026-10-23T12:00:00Z");
  const router = new ModelFallbackRouter(() => now);
  const calls = [];
  const invoke = async model => {
    calls.push(model);
    if (model === "best" && calls.length === 1) throw quota();
    return model;
  };
  await router.run(["best", "next"], invoke, options);
  await router.run(["best", "next"], invoke, options);
  assert.deepEqual(calls, ["best", "next", "next"]);
  now = nextDailyQuotaReset(now) + 1;
  assert.equal(await router.run(["best", "next"], invoke, options), "best");
});

test("mid-job quota on an initially working model switches later calls to the next model", async () => {
  const router = new ModelFallbackRouter();
  let stage = 1;
  const calls = [];
  const invoke = async model => {
    calls.push(`${stage}:${model}`);
    if (stage > 1 && model === "best") throw quota();
    return model;
  };
  assert.equal(await router.run(["best", "next"], invoke, options), "best");
  stage = 2;
  assert.equal(await router.run(["best", "next"], invoke, options), "next");
  stage = 3;
  assert.equal(await router.run(["best", "next"], invoke, options), "next");
  assert.deepEqual(calls, ["1:best", "2:best", "2:next", "3:next"]);
});

test("temporary quota cooldown respects RetryInfo and restores best-first afterwards", async () => {
  let now = Date.parse("2026-10-23T12:00:00Z");
  const router = new ModelFallbackRouter(() => now);
  let failed = false;
  const invoke = async model => {
    if (model === "best" && !failed) {
      failed = true;
      throw quota('{"details":[{"retryDelay":"2s"}]}');
    }
    return model;
  };
  assert.equal(await router.run(["best", "next"], invoke, options), "next");
  now += 2999;
  assert.equal(await router.run(["best", "next"], invoke, options), "next");
  now += 2;
  assert.equal(await router.run(["best", "next"], invoke, options), "best");
});

test("all-quota failures, including fully cached failures, keep distinct quota errors", async () => {
  for (const [message, expected] of [["RequestsPerDay quota exceeded", "daily"], ["Please retry in 10s", "temporary"]]) {
    const router = new ModelFallbackRouter();
    let count = 0;
    const invoke = async () => { count++; throw quota(message); };
    await assert.rejects(router.run(["a", "b"], invoke, options), { message: expected, quota: true });
    await assert.rejects(router.run(["a", "b"], invoke, options), { message: expected, quota: true });
    assert.equal(count, 2);
  }
});

test("billing metadata failures stop immediately, never repeating an unmetered successful response", async () => {
  const router = new ModelFallbackRouter();
  const fatal = new Error("Invalid token usage");
  const calls = [];
  await assert.rejects(router.run(["best", "next"], async model => {
    calls.push(model);
    throw fatal;
  }, { ...options, isFatal: error => error === fatal }), error => error === fatal);
  assert.deepEqual(calls, ["best"]);
});

test("missing model falls back and is cooled down, ordinary failures are not mislabeled quota", async () => {
  const router = new ModelFallbackRouter();
  const missing = Object.assign(new Error("Model not found"), { status: 404 });
  const calls = [];
  const invoke = async model => { calls.push(model); if (model === "gone") throw missing; return model; };
  await router.run(["gone", "working", "working"], invoke, options);
  await router.run(["gone", "working"], invoke, options);
  assert.deepEqual(calls, ["gone", "working", "working"]);
  const broken = new ModelFallbackRouter();
  const ordinary = new Error("Connection lost");
  await assert.rejects(broken.run(["a"], async () => { throw ordinary; }, options), error => error === ordinary);
});

test("empty chains fail explicitly and quota detection is case insensitive", async () => {
  await assert.rejects(new ModelFallbackRouter().run([], async () => "", options), /No suitable/);
  assert.equal(isQuotaError(new Error("RESOURCE_EXHAUSTED")), true);
  assert.equal(isQuotaError(new Error("Quota exceeded")), true);
  assert.equal(isQuotaError(new Error("No token usage metadata")), false);
});

test("Pacific daily reset handles winter, summer, and both DST transitions", () => {
  for (const [now, reset] of [
    ["2026-10-23T12:00:00Z", "2026-10-24T07:00:00Z"],
    ["2026-01-05T12:00:00Z", "2026-01-06T08:00:00Z"],
    ["2026-03-08T09:00:00Z", "2026-03-09T07:00:00Z"],
    ["2026-11-01T08:00:00Z", "2026-11-02T08:00:00Z"],
  ]) assert.equal(new Date(nextDailyQuotaReset(Date.parse(now))).toISOString(), new Date(reset).toISOString());
});

test("an unresponsive provider is aborted within the model deadline", async () => {
  let signal;
  await assert.rejects(withModelTimeout(15, async received => {
    signal = received;
    return new Promise(() => {});
  }), GeminiModelTimeoutError);
  assert.equal(signal.aborted, true);
});

test("provider success and failure clear their timeout without late aborts", async () => {
  let signal;
  assert.equal(await withModelTimeout(15, async received => {
    signal = received;
    return "ok";
  }), "ok");
  const original = new Error("provider failure");
  await assert.rejects(withModelTimeout(15, async () => { throw original; }), error => error === original);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(signal.aborted, false);
});

test("a timed-out model falls back immediately and is skipped by the next stage", async () => {
  const router = new ModelFallbackRouter();
  const calls = [];
  const invoke = async model => {
    calls.push(model);
    if (model === "slow") return withModelTimeout(10, () => new Promise(() => {}));
    return "response";
  };
  assert.equal(await router.run(["slow", "working"], invoke, options), "response");
  assert.equal(await router.run(["slow", "working"], invoke, options), "response");
  assert.deepEqual(calls, ["slow", "working", "working"]);
});

test("503 overload falls back once instead of retrying the same model at every stage", async () => {
  const router = new ModelFallbackRouter();
  const calls = [];
  const invoke = async model => {
    calls.push(model);
    if (model === "busy") throw Object.assign(new Error("high demand"), { status: 503 });
    return model;
  };
  assert.equal(await router.run(["busy", "working"], invoke, options), "working");
  assert.equal(await router.run(["busy", "working"], invoke, options), "working");
  assert.deepEqual(calls, ["busy", "working", "working"]);
});

test("the overall deadline prevents walking a long chain forever", async () => {
  let now = 100;
  const router = new ModelFallbackRouter(() => now);
  const calls = [];
  await assert.rejects(router.run(["a", "b", "c"], async model => {
    calls.push(model);
    now = 201;
    throw new GeminiModelTimeoutError();
  }, { ...options, deadline: 200 }), GeminiDeadlineError);
  assert.deepEqual(calls, ["a"]);
});

test("short local budgets never send a provider deadline below Google's ten-second minimum", () => {
  assert.deepEqual(modelRequestTimeouts(20_000, 2819), {
    localTimeoutMs: 2819, providerTimeoutMs: 10_000,
  });
  assert.deepEqual(modelRequestTimeouts(20_000, 75_000), {
    localTimeoutMs: 20_000, providerTimeoutMs: 20_000,
  });
  assert.deepEqual(modelRequestTimeouts(10_000, 25_000), {
    localTimeoutMs: 10_000, providerTimeoutMs: 10_000,
  });
  assert.throws(() => modelRequestTimeouts(20_000, 0), GeminiDeadlineError);
});

test("a cold first request reaches Flash-Lite before its budget expires, without stopping or reloading", async () => {
  let now = 0;
  const router = new ModelFallbackRouter(() => now);
  const calls = [];
  const chain = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite"];
  const result = await router.run(chain, async model => {
    calls.push(model);
    if (!model.endsWith("-lite")) {
      now += 20_000;
      throw new GeminiModelTimeoutError();
    }
    now += 1000;
    return model;
  }, { ...options, deadline: 75_000, fastFallbackWindowMs: 20_000 });
  assert.equal(result, "gemini-3.5-flash-lite");
  assert.equal(now, 61_000);
  assert.deepEqual(calls, ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]);
});

test("the reserved fallback window does not override a working best model or retry blocked models", async () => {
  const router = new ModelFallbackRouter(() => 0);
  const calls = [];
  assert.equal(await router.run(["gemini-4-argon", "gemini-3.5-flash-lite"], async model => {
    calls.push(model);
    return model;
  }, { ...options, deadline: 75_000, fastFallbackWindowMs: 20_000 }), "gemini-4-argon");
  assert.deepEqual(calls, ["gemini-4-argon"]);
});
