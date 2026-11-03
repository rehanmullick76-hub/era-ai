import assert from "node:assert/strict";
import test from "node:test";
import {
  getGoogleRedirectUri,
  sanitizeReturnTo,
} from "../src/lib/google-oauth.ts";

test("Google return paths stay inside ERA", () => {
  assert.equal(sanitizeReturnTo("/projects/demo?view=build"), "/projects/demo?view=build");
  assert.equal(sanitizeReturnTo("https://example.com"), "/");
  assert.equal(sanitizeReturnTo("//example.com"), "/");
  assert.equal(sanitizeReturnTo("/\\example.com"), "/");
  assert.equal(sanitizeReturnTo("/safe\nheader"), "/");
});

test("Google callback URI uses the trusted Replit preview host", () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    devDomain: process.env.REPLIT_DEV_DOMAIN,
    domains: process.env.REPLIT_DOMAINS,
    origins: process.env.ALLOWED_ORIGINS,
    publicOrigin: process.env.AUTH_PUBLIC_ORIGIN,
    override: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  };
  try {
    process.env.NODE_ENV = "development";
    process.env.REPLIT_DEV_DOMAIN = "preview.replit.dev";
    delete process.env.REPLIT_DOMAINS;
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.AUTH_PUBLIC_ORIGIN;
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;

    assert.equal(
      getGoogleRedirectUri({
        protocol: "https",
        get: () => "preview.replit.dev",
      }),
      "https://preview.replit.dev/api/auth/google/callback",
    );
    assert.throws(
      () =>
        getGoogleRedirectUri({
          protocol: "https",
          get: () => "attacker.example",
        }),
      /not enabled for this host/,
    );
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.devDomain === undefined) delete process.env.REPLIT_DEV_DOMAIN;
    else process.env.REPLIT_DEV_DOMAIN = previous.devDomain;
    if (previous.domains === undefined) delete process.env.REPLIT_DOMAINS;
    else process.env.REPLIT_DOMAINS = previous.domains;
    if (previous.origins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previous.origins;
    if (previous.publicOrigin === undefined) delete process.env.AUTH_PUBLIC_ORIGIN;
    else process.env.AUTH_PUBLIC_ORIGIN = previous.publicOrigin;
    if (previous.override === undefined) delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    else process.env.GOOGLE_OAUTH_REDIRECT_URI = previous.override;
  }
});

test("Google callback URI uses the allowlisted forwarded preview host", () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    devDomain: process.env.REPLIT_DEV_DOMAIN,
    domains: process.env.REPLIT_DOMAINS,
    origins: process.env.ALLOWED_ORIGINS,
    publicOrigin: process.env.AUTH_PUBLIC_ORIGIN,
    override: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  };
  try {
    process.env.NODE_ENV = "development";
    process.env.REPLIT_DEV_DOMAIN = "preview.replit.dev";
    delete process.env.REPLIT_DOMAINS;
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.AUTH_PUBLIC_ORIGIN;
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;

    assert.equal(
      getGoogleRedirectUri({
        protocol: "https",
        get: (header) =>
          header === "x-forwarded-host"
            ? "preview.replit.dev, api.internal"
            : "api.internal",
      }),
      "https://preview.replit.dev/api/auth/google/callback",
    );
    assert.throws(
      () =>
        getGoogleRedirectUri({
          protocol: "https",
          get: (header) =>
            header === "x-forwarded-host" ? "attacker.example" : "localhost",
        }),
      /not enabled for this host/,
    );
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.devDomain === undefined) delete process.env.REPLIT_DEV_DOMAIN;
    else process.env.REPLIT_DEV_DOMAIN = previous.devDomain;
    if (previous.domains === undefined) delete process.env.REPLIT_DOMAINS;
    else process.env.REPLIT_DOMAINS = previous.domains;
    if (previous.origins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previous.origins;
    if (previous.publicOrigin === undefined) delete process.env.AUTH_PUBLIC_ORIGIN;
    else process.env.AUTH_PUBLIC_ORIGIN = previous.publicOrigin;
    if (previous.override === undefined) delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    else process.env.GOOGLE_OAUTH_REDIRECT_URI = previous.override;
  }
});

test("Google callback URI accepts the matching Replit pike.repl.co alias", () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    devDomain: process.env.REPLIT_DEV_DOMAIN,
    domains: process.env.REPLIT_DOMAINS,
    origins: process.env.ALLOWED_ORIGINS,
    publicOrigin: process.env.AUTH_PUBLIC_ORIGIN,
    override: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  };
  try {
    process.env.NODE_ENV = "development";
    process.env.REPLIT_DEV_DOMAIN =
      "f0a4d6b6-a490-4ac6-abc1-8fbc7eba06f2-00-15udlji2si1s2.pike.replit.dev";
    delete process.env.REPLIT_DOMAINS;
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.AUTH_PUBLIC_ORIGIN;
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;

    assert.equal(
      getGoogleRedirectUri({
        protocol: "https",
        get: (header) =>
          header === "x-forwarded-host"
            ? "f0a4d6b6-a490-4ac6-abc1-8fbc7eba06f2-00-15udlji2si1s2.pike.repl.co"
            : "api.internal",
      }),
      "https://f0a4d6b6-a490-4ac6-abc1-8fbc7eba06f2-00-15udlji2si1s2.pike.repl.co/api/auth/google/callback",
    );
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.devDomain === undefined) delete process.env.REPLIT_DEV_DOMAIN;
    else process.env.REPLIT_DEV_DOMAIN = previous.devDomain;
    if (previous.domains === undefined) delete process.env.REPLIT_DOMAINS;
    else process.env.REPLIT_DOMAINS = previous.domains;
    if (previous.origins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previous.origins;
    if (previous.publicOrigin === undefined) delete process.env.AUTH_PUBLIC_ORIGIN;
    else process.env.AUTH_PUBLIC_ORIGIN = previous.publicOrigin;
    if (previous.override === undefined) delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    else process.env.GOOGLE_OAUTH_REDIRECT_URI = previous.override;
  }
});
