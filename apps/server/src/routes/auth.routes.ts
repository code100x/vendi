import { Router } from "express";
import { generateState, generateCodeVerifier } from "arctic";
import { lucia, google, github } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { encrypt } from "../lib/crypto";
import { env } from "../config/env";
import type { AuthUser } from "@vendi/shared";

const router = Router();

const OAUTH_STATE_COOKIE_MAX_AGE = 60 * 10; // 10 minutes in seconds

// ─── GET /auth/google ────────────────────────────────────────────────────────

router.get("/google", (_req, res) => {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();

  const url = google.createAuthorizationURL(state, codeVerifier, [
    "openid",
    "email",
    "profile",
  ]);

  res.cookie("google_oauth_state", state, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: OAUTH_STATE_COOKIE_MAX_AGE * 1000,
    path: "/",
  });
  res.cookie("google_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: OAUTH_STATE_COOKIE_MAX_AGE * 1000,
    path: "/",
  });

  res.redirect(url.toString());
});

// ─── GET /auth/google/callback ───────────────────────────────────────────────

router.get("/google/callback", async (req, res) => {
  const { code, state } = req.query;
  const storedState = req.cookies?.google_oauth_state;
  const storedCodeVerifier = req.cookies?.google_code_verifier;

  if (
    !code ||
    !state ||
    !storedState ||
    !storedCodeVerifier ||
    state !== storedState
  ) {
    return res.redirect(env.FRONTEND_URL + "/signin?error=auth_failed");
  }

  try {
    const tokens = await google.validateAuthorizationCode(
      code as string,
      storedCodeVerifier as string
    );

    const accessToken = tokens.accessToken();

    // Fetch user info from Google
    const googleUserResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!googleUserResponse.ok) {
      return res.redirect(env.FRONTEND_URL + "/signin?error=auth_failed");
    }

    const googleUser = (await googleUserResponse.json()) as {
      sub: string;
      email: string;
      name?: string;
      picture?: string;
    };

    // Find or create user + OAuthAccount
    const user = await findOrCreateUserFromOAuth({
      provider: "google",
      providerAccountId: googleUser.sub,
      email: googleUser.email,
      name: googleUser.name ?? null,
      avatarUrl: googleUser.picture ?? null,
      accessToken,
      refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : null,
    });

    // Create Lucia session
    const session = await lucia.createSession(user.id, {});
    const cookie = lucia.createSessionCookie(session.id);
    res.cookie(cookie.name, cookie.value, cookie.attributes);

    // Clear OAuth cookies
    res.clearCookie("google_oauth_state");
    res.clearCookie("google_code_verifier");

    res.redirect(
      env.FRONTEND_URL + "/auth/callback/google?success=true"
    );
  } catch (error) {
    console.error("Google OAuth callback error:", error);
    res.redirect(env.FRONTEND_URL + "/signin?error=auth_failed");
  }
});

// ─── GET /auth/github ────────────────────────────────────────────────────────

router.get("/github", (_req, res) => {
  const state = generateState();

  const url = github.createAuthorizationURL(state, ["user:email", "repo"]);

  res.cookie("github_oauth_state", state, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: OAUTH_STATE_COOKIE_MAX_AGE * 1000,
    path: "/",
  });

  res.redirect(url.toString());
});

// ─── GET /auth/github/callback ──────────────────────────────────────────────

router.get("/github/callback", async (req, res) => {
  const { code, state } = req.query;
  const storedState = req.cookies?.github_oauth_state;

  if (!code || !state || !storedState || state !== storedState) {
    return res.redirect(env.FRONTEND_URL + "/signin?error=auth_failed");
  }

  try {
    const tokens = await github.validateAuthorizationCode(code as string);
    const accessToken = tokens.accessToken();

    // Fetch GitHub user
    const githubUserResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "Vendi",
      },
    });

    if (!githubUserResponse.ok) {
      return res.redirect(env.FRONTEND_URL + "/signin?error=auth_failed");
    }

    const githubUser = (await githubUserResponse.json()) as {
      id: number;
      login: string;
      name?: string;
      avatar_url?: string;
      email?: string;
    };

    // Fetch primary email if not available on profile
    let email = githubUser.email;
    if (!email) {
      const emailsResponse = await fetch(
        "https://api.github.com/user/emails",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": "Vendi",
          },
        }
      );

      if (emailsResponse.ok) {
        const emails = (await emailsResponse.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        const primary = emails.find((e) => e.primary && e.verified);
        email = primary?.email ?? emails.find((e) => e.verified)?.email;
      }
    }

    if (!email) {
      return res.redirect(env.FRONTEND_URL + "/signin?error=auth_failed");
    }

    // Encrypt the access token before storing
    const { encrypted: encryptedAccessToken, iv: accessTokenIv } =
      encrypt(accessToken);
    const storedAccessToken = `${encryptedAccessToken}|${accessTokenIv}`;

    // Find or create user + OAuthAccount
    const user = await findOrCreateUserFromOAuth({
      provider: "github",
      providerAccountId: githubUser.id.toString(),
      email,
      name: githubUser.name ?? githubUser.login,
      avatarUrl: githubUser.avatar_url ?? null,
      accessToken: storedAccessToken,
      refreshToken: null,
      githubId: githubUser.login,
    });

    // Create Lucia session
    const session = await lucia.createSession(user.id, {});
    const cookie = lucia.createSessionCookie(session.id);
    res.cookie(cookie.name, cookie.value, cookie.attributes);

    // Clear OAuth cookie
    res.clearCookie("github_oauth_state");

    res.redirect(
      env.FRONTEND_URL + "/auth/callback/github?success=true"
    );
  } catch (error) {
    console.error("GitHub OAuth callback error:", error);
    res.redirect(env.FRONTEND_URL + "/signin?error=auth_failed");
  }
});

// ─── GET /auth/me ────────────────────────────────────────────────────────────

router.get("/me", requireAuth, async (_req, res) => {
  try {
    const luciaUser = res.locals.user;

    const dbUser = await prisma.user.findUnique({
      where: { id: luciaUser.id },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        encryptedApiKey: true,
        githubId: true,
      },
    });

    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const authUser: AuthUser = {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      avatarUrl: dbUser.avatarUrl,
      hasApiKey: !!dbUser.encryptedApiKey,
      hasGithubLinked: !!dbUser.githubId,
    };

    res.json(authUser);
  } catch (error) {
    console.error("Error fetching current user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /auth/logout ──────────────────────────────────────────────────────

router.post("/logout", requireAuth, async (_req, res) => {
  try {
    const session = res.locals.session;
    await lucia.invalidateSession(session.id);

    const blankCookie = lucia.createBlankSessionCookie();
    res.cookie(blankCookie.name, blankCookie.value, blankCookie.attributes);

    res.json({ success: true });
  } catch (error) {
    console.error("Error during logout:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Helper: Find or create user from OAuth ─────────────────────────────────

interface OAuthUserInfo {
  provider: "google" | "github";
  providerAccountId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  accessToken: string;
  refreshToken: string | null;
  githubId?: string;
}

async function findOrCreateUserFromOAuth(info: OAuthUserInfo) {
  const {
    provider,
    providerAccountId,
    email,
    name,
    avatarUrl,
    accessToken,
    refreshToken,
    githubId,
  } = info;

  // 1. Check if this OAuth account already exists
  const existingOAuth = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider,
        providerAccountId,
      },
    },
    include: { user: true },
  });

  if (existingOAuth) {
    // Update the access token and user info
    await prisma.oAuthAccount.update({
      where: { id: existingOAuth.id },
      data: {
        accessToken,
        refreshToken,
      },
    });

    // Update user profile info
    const updateData: Record<string, unknown> = {};
    if (name && !existingOAuth.user.name) updateData.name = name;
    if (avatarUrl && !existingOAuth.user.avatarUrl)
      updateData.avatarUrl = avatarUrl;
    if (provider === "github" && githubId && !existingOAuth.user.githubId)
      updateData.githubId = githubId;
    if (provider === "google" && !existingOAuth.user.googleId)
      updateData.googleId = providerAccountId;

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { id: existingOAuth.user.id },
        data: updateData,
      });
    }

    return existingOAuth.user;
  }

  // 2. Check if a user with this email already exists (account linking)
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    // Link the new OAuth provider to the existing user
    await prisma.oAuthAccount.create({
      data: {
        userId: existingUser.id,
        provider,
        providerAccountId,
        accessToken,
        refreshToken,
      },
    });

    // Update provider-specific fields
    const updateData: Record<string, unknown> = {};
    if (provider === "github" && githubId && !existingUser.githubId)
      updateData.githubId = githubId;
    if (provider === "google" && !existingUser.googleId)
      updateData.googleId = providerAccountId;
    if (name && !existingUser.name) updateData.name = name;
    if (avatarUrl && !existingUser.avatarUrl) updateData.avatarUrl = avatarUrl;

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: updateData,
      });
    }

    return existingUser;
  }

  // 3. Create a brand new user + OAuthAccount
  const newUser = await prisma.user.create({
    data: {
      email,
      name,
      avatarUrl,
      ...(provider === "github" && githubId ? { githubId } : {}),
      ...(provider === "google" ? { googleId: providerAccountId } : {}),
      oauthAccounts: {
        create: {
          provider,
          providerAccountId,
          accessToken,
          refreshToken,
        },
      },
    },
  });

  return newUser;
}

export default router;
