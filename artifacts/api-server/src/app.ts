import { existsSync } from "node:fs";
import path from "node:path";
import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
app.set("trust proxy", 1);

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? process.env.REPLIT_DOMAINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean)
  .map((o) => (o.startsWith("http") ? o : `https://${o}`));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  }),
);

app.use(cookieParser());

const defaultJsonParser = express.json({ limit: "2mb" });
app.use((req, res, next) => {
  if (req.method === "POST" && req.path === "/api/ai/read-attachments") {
    next();
    return;
  }
  defaultJsonParser(req, res, next);
});

app.use("/api", router);

const frontendCandidates = [
  path.resolve(process.cwd(), "artifacts/era/dist/public"),
  path.resolve(process.cwd(), "../era/dist/public"),
];
const frontendDistDir = frontendCandidates.find((dir) =>
  existsSync(path.join(dir, "index.html")),
);

if (frontendDistDir) {
  app.use(express.static(frontendDistDir));
  app.use((req, res, next) => {
    if (
      (req.method !== "GET" && req.method !== "HEAD") ||
      req.path.startsWith("/api")
    ) {
      next();
      return;
    }

    res.sendFile(path.join(frontendDistDir, "index.html"));
  });
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const error = err as { status?: number; message?: string };
  res.status(error.status || 500).json({
    error: error.message || "Internal server error",
  });
};

app.use(errorHandler);

export default app;
