import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { isAiJobRead } from "../lib/aiRatePolicy";

export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  skip: (req) => isAiJobRead(req.method, req.path),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  validate: { xForwardedForHeader: false },
  message: { error: "Too many AI requests. Please wait a minute and try again." },
});
