import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import googleClient from "../config/google.js";
import { issueSession } from "../utils/session.js";
import { resolveGoogleAccount } from "../services/google-account.service.js";
import { notifyAuthActivity } from "../services/auth-notification.service.js";
import WorkspaceInvitation from "../models/workspace-invitation.model.js";
import WorkspaceMember from "../models/workspace-member.model.js";
import Workspace from "../models/workspace.model.js";
import { migrateLegacyTasks } from "../utils/migrate-legacy-tasks.js";
import { reserveWorkspaceMembership, WorkspaceLimitError } from "../services/workspace-capacity.service.js";
import { emitWorkspaceMembersChanged } from "../services/realtime.service.js";

const frontendUrl = () => (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
const isProduction = process.env.NODE_ENV === "production";

export const redirectToGoogleAuthorization = (request, response) => {
  const inviteToken = typeof request.query.inviteToken === "string" ? request.query.inviteToken : "";
  if (inviteToken && !/^[a-f\d]{64}$/i.test(inviteToken)) {
    return response.redirect(`${frontendUrl()}/login?authError=invite`);
  }
  const state = randomBytes(32).toString("hex");
  response.cookie("oauthState", state, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 5 * 60 * 1000,
    path: "/api/auth",
  });
  if (inviteToken) {
    response.cookie("oauthInviteToken", inviteToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 5 * 60 * 1000,
      path: "/api/auth",
    });
  }
  const authorizationUrl = googleClient.generateAuthUrl({
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
  });

  return response.redirect(authorizationUrl);
};

export const handleGoogleOAuthCallback = async (request, response) => {
  const expectedState = request.cookies?.oauthState;
  const inviteToken = request.cookies?.oauthInviteToken;
  const receivedState = typeof request.query.state === "string" ? request.query.state : "";
  response.clearCookie("oauthState", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/api/auth",
  });
  response.clearCookie("oauthInviteToken", {
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

    if (inviteToken) {
      const invitation = await WorkspaceInvitation.findOne({
        tokenHash: createHash("sha256").update(inviteToken).digest("hex"),
        status: "pending",
        expiresAt: { $gt: new Date() },
      });
      if (!invitation || invitation.email !== authenticatedUser.email.toLowerCase()) {
        await issueSession(response, authenticatedUser);
        return response.redirect(`${frontendUrl()}/workspaces?inviteError=invalid`);
      }

      if (await WorkspaceMember.exists({ userId: authenticatedUser._id, workspaceId: invitation.workspaceId })) {
        await issueSession(response, authenticatedUser);
        return response.redirect(`${frontendUrl()}/workspaces?inviteError=already-member`);
      }

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const invitedWorkspace = await Workspace.findById(invitation.workspaceId)
            .select("timezone")
            .session(session);
          await reserveWorkspaceMembership(authenticatedUser._id, session);
          await WorkspaceMember.create([{
            workspaceId: invitation.workspaceId,
            userId: authenticatedUser._id,
            role: "member",
          }], { session });
          await migrateLegacyTasks({
            userId: authenticatedUser._id,
            workspaceId: invitation.workspaceId,
            timezone: invitedWorkspace.timezone,
            session,
          });
          const acceptedInvitation = await WorkspaceInvitation.findOneAndUpdate(
            { _id: invitation._id, status: "pending", expiresAt: { $gt: new Date() } },
            { $set: { status: "accepted", acceptedAt: new Date() } },
            { new: true, session }
          );
          if (!acceptedInvitation) throw new Error("Invitation is no longer pending");
        });
      } catch (error) {
        if (!(error instanceof WorkspaceLimitError)) throw error;
        await issueSession(response, authenticatedUser);
        return response.redirect(`${frontendUrl()}/workspaces?inviteError=limit`);
      } finally {
        await session.endSession();
      }
      emitWorkspaceMembersChanged(invitation.workspaceId);
    }

    await issueSession(response, authenticatedUser);
    void notifyAuthActivity(authenticatedUser, "sign-in");

    return response.redirect(`${frontendUrl()}/workspaces`);
  } catch (error) {
    console.error("Google OAuth callback error:", error);
    return response.redirect(`${frontendUrl()}/login?authError=google`);
  }
};
