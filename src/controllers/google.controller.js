import { randomBytes, timingSafeEqual } from "node:crypto";
import googleClient from "../config/google.js";
import { issueSession } from "../utils/session.js";
import { resolveGoogleAccount } from "../services/google-account.service.js";
import { notifyAuthActivity } from "../services/auth-notification.service.js";

const frontendUrl = () => (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
const isProduction = process.env.NODE_ENV === "production";

export const redirectToGoogleAuthorization = (request, response) => {
  const state = randomBytes(32).toString("hex");
  response.cookie("oauthState", state, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 5 * 60 * 1000,
    path: "/api/auth",
  });
  const authorizationUrl = googleClient.generateAuthUrl({
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
  });

  return response.redirect(authorizationUrl);
};

export const handleGoogleOAuthCallback = async (request, response) => {
  const expectedState = request.cookies?.oauthState;
  const receivedState = typeof request.query.state === "string" ? request.query.state : "";
  response.clearCookie("oauthState", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/api/auth",
  });

  const expectedBuffer = Buffer.from(expectedState || "");
  const receivedBuffer = Buffer.from(receivedState);
  if (
    !expectedState ||
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return response.redirect(`${frontendUrl()}/login?authError=google`);
  }

  try {
    const { code } = request.query;

    if (!code) {
      return response.redirect(`${frontendUrl()}/login?authError=google`);
    }

    const { tokens } = await googleClient.getToken(code);

    if (!tokens.id_token) {
      return response.status(401).json({
        message: "Google did not return an ID token",
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const verifiedIdentity = ticket.getPayload();

    if (!verifiedIdentity?.sub || !verifiedIdentity.email || !verifiedIdentity.email_verified) {
      return response.redirect(`${frontendUrl()}/login?authError=google`);
    }

    const authenticatedUser = await resolveGoogleAccount(verifiedIdentity);

    await issueSession(response, authenticatedUser);
    void notifyAuthActivity(authenticatedUser, "sign-in");

    return response.redirect(`${frontendUrl()}/dashboard`);
  } catch (error) {
    console.error("Google OAuth callback error:", error);
    return response.redirect(`${frontendUrl()}/login?authError=google`);
  }
};