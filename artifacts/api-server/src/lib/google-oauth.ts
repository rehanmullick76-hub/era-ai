import { OAuth2Client } from "google-auth-library";
import type { Request } from "express";

const CALLBACK_PATH = "/api/auth/google/callback";
const DEFAULT_PRODUCTION_ORIGIN = "https://era-ai-69zg.onrender.com";

function parseHost(value: string): string | null {
  try {
    const parsed = value.includes("://") ? new URL(value) : new URL(`https://${value}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function allowedHosts(): Set<string> {
  const configured = [
    DEFAULT_PRODUCTION_ORIGIN,
    process.env.AUTH_PUBLIC_ORIGIN,
    process.env.AUTH_ALLOWED_ORIGINS,
    process.env.ALLOWED_ORIGINS,
    process.env.REPLIT_DOMAINS,
    process.env.REPLIT_DEV_DOMAIN,
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(","))
    .map((value) => parseHost(value.trim()))
    .filter((host): host is string => Boolean(host));

  for (const host of [...configured]) {
    if (host.endsWith(".pike.replit.dev")) {
      configured.push(`${host.slice(0, -".pike.replit.dev".length)}.pike.repl.co`);
    } else if (host.endsWith(".pike.repl.co")) {
      configured.push(`${host.slice(0, -".pike.repl.co".length)}.pike.replit.dev`);
    }
  }

  return new Set([
    ...configured,
    ...(process.env.NODE_ENV !== "production" ? ["localhost", "127.0.0.1"] : []),
  ]);
}

export function getGoogleRedirectUri(req: Request): string {
  const override = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (override) {
    const parsed = new URL(override);
    if (
      parsed.pathname !== CALLBACK_PATH ||
      parsed.search ||
      parsed.hash ||
      (parsed.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(parsed.hostname))
    ) {
      throw new Error("GOOGLE_OAUTH_REDIRECT_URI must be an HTTPS Google callback URL.");
    }
    return parsed.toString();
  }

  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host");
  if (!host) throw new Error("Request host is unavailable.");
  const origin = new URL(`${req.protocol}://${host}`);
  if (!allowedHosts().has(origin.hostname.toLowerCase())) {
    throw new Error("Google sign-in is not enabled for this host.");
  }
  if (origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname)) {
    throw new Error("Google sign-in requires HTTPS.");
  }
  return new URL(CALLBACK_PATH, origin).toString();
}

export function createGoogleOAuthClient(redirectUri: string): OAuth2Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are not configured.");
  }
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

export function getGoogleClientId(): string | null {
  return process.env.GOOGLE_OAUTH_CLIENT_ID || null;
}

export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  return value;
}
