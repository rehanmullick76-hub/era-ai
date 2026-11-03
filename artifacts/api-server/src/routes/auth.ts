import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import { CodeChallengeMethod } from "google-auth-library";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import {
  authAccountsTable,
  db,
  googleOAuthStatesTable,
} from "@workspace/db";
import { ensureUser, getCredits } from "../lib/credits";
import { rejectLegacyGuestAuthentication } from "../lib/legacy-guest-auth";
import { authMiddleware } from "../middlewares/auth";
import {
  AUTH_SESSION_COOKIE,
  AUTH_SESSION_TTL_MS,
  createAuthSession,
  getAuthenticatedSessionUser,
  findOrCreateGoogleUser,
  revokeAuthSession,
} from "../lib/auth-session";
import {
  createGoogleOAuthClient,
  getGoogleClientId,
  getGoogleRedirectUri,
  sanitizeReturnTo,
} from "../lib/google-oauth";

const router: IRouter = Router();
const googleLoginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/auth/guest", rejectLegacyGuestAuthentication);

router.get("/auth/me", async (req, res): Promise<void> => {
  const userId = await getAuthenticatedSessionUser(req);
  if (!userId) {
    res.status(200).json({
      authenticated: false,
      userId: null,
      credits: 0,
      email: null,
      displayName: null,
      avatarUrl: null,
      authProvider: null,
    });
    return;
  }

  await ensureUser(userId);
  const [account] = await db
    .select({
      email: authAccountsTable.email,
      displayName: authAccountsTable.name,
      avatarUrl: authAccountsTable.avatarUrl,
    })
    .from(authAccountsTable)
    .where(
      and(
        eq(authAccountsTable.userId, userId),
        eq(authAccountsTable.provider, "google"),
      ),
    )
    .limit(1);
  res.json({
    authenticated: true,
    userId,
    credits: await getCredits(userId),
    email: account?.email ?? null,
    displayName: account?.displayName ?? null,
    avatarUrl: account?.avatarUrl ?? null,
    authProvider: "google",
  });
});

router.get("/auth/google", googleLoginLimiter, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const clientId = getGoogleClientId();
  if (!clientId || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    res.redirect(302, "/sign-in?error=google_not_configured");
    return;
  }

  let setupStage = "resolve_redirect_uri";
  try {
    const redirectUri = getGoogleRedirectUri(req);
    const client = createGoogleOAuthClient(redirectUri);
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    setupStage = "generate_pkce";
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    if (!codeChallenge) throw new Error("Google OAuth PKCE challenge unavailable.");

    const now = new Date();
    setupStage = "save_oauth_state";
    await db.delete(googleOAuthStatesTable)
      .where(lte(googleOAuthStatesTable.expiresAt, now));
    await db.insert(googleOAuthStatesTable).values({
      stateHash: createHash("sha256").update(state).digest("hex"),
      nonce,
      codeVerifier,
      redirectUri,
      returnTo: sanitizeReturnTo(req.query.returnTo),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    });

    setupStage = "build_google_authorization_url";
    const authorizationUrl = client.generateAuthUrl({
      access_type: "online",
      scope: ["openid", "email", "profile"],
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      prompt: "select_account",
    });
    res.redirect(302, authorizationUrl);
  } catch (error) {
    const safeError = error as { name?: unknown; code?: unknown };
    req.log.warn(
      {
        reason: "google_oauth_start_failed",
        stage: setupStage,
        errorName: typeof safeError?.name === "string" ? safeError.name : "UnknownError",
        errorCode: typeof safeError?.code === "string" ? safeError.code : undefined,
        requestHost: req.get("x-forwarded-host") ?? req.get("host"),
        requestProtocol: req.protocol,
      },
      "Google sign-in could not start",
    );
    res.redirect(302, "/sign-in?error=google_setup_error");
  }
});

router.get("/auth/google/callback", googleLoginLimiter, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const error = typeof req.query.error === "string" ? req.query.error : null;
  if (error) {
    res.redirect(302, "/sign-in?error=google_cancelled");
    return;
  }

  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!state || !code || state.length > 256 || code.length > 4096) {
    res.redirect(302, "/sign-in?error=google_invalid_response");
    return;
  }

  try {
    const stateHash = createHash("sha256").update(state).digest("hex");
    const now = new Date();
    const [pending] = await db
      .delete(googleOAuthStatesTable)
      .where(
        and(
          eq(googleOAuthStatesTable.stateHash, stateHash),
          gt(googleOAuthStatesTable.expiresAt, now),
        ),
      )
      .returning({
        nonce: googleOAuthStatesTable.nonce,
        codeVerifier: googleOAuthStatesTable.codeVerifier,
        redirectUri: googleOAuthStatesTable.redirectUri,
        returnTo: googleOAuthStatesTable.returnTo,
      });
    if (!pending) {
      res.redirect(302, "/sign-in?error=google_state_expired");
      return;
    }

    const client = createGoogleOAuthClient(pending.redirectUri);
    const { tokens } = await client.getToken({
      code,
      codeVerifier: pending.codeVerifier,
      redirect_uri: pending.redirectUri,
    });
    if (!tokens.id_token) {
      res.redirect(302, "/sign-in?error=google_token_missing");
      return;
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: getGoogleClientId()!,
    });
    const claims = ticket.getPayload();
    if (
      !claims?.sub ||
      !claims.email ||
      claims.email_verified !== true ||
      claims.nonce !== pending.nonce
    ) {
      res.redirect(302, "/sign-in?error=google_identity_invalid");
      return;
    }

    const userId = await findOrCreateGoogleUser({
      subject: claims.sub,
      email: claims.email,
      name: claims.name?.trim() || claims.email,
      avatarUrl: claims.picture ?? null,
    });
    const session = await createAuthSession(userId);
    res.cookie(AUTH_SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: req.secure || process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: AUTH_SESSION_TTL_MS,
    });
    res.redirect(302, sanitizeReturnTo(pending.returnTo));
  } catch {
    req.log.warn({ reason: "google_oauth_callback_failed" }, "Google sign-in callback failed");
    res.redirect(302, "/sign-in?error=google_callback_failed");
  }
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await revokeAuthSession(req.cookies?.[AUTH_SESSION_COOKIE]);
  res.clearCookie(AUTH_SESSION_COOKIE, {
    httpOnly: true,
    secure: req.secure || process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  res.sendStatus(204);
});

export default router;
