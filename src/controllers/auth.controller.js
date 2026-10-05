import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import User from "../models/user.model.js";
import WorkspaceInvitation from "../models/workspace-invitation.model.js";
import WorkspaceMember from "../models/workspace-member.model.js";
import Workspace from "../models/workspace.model.js";
import { emailSchemaInput, emailVerificationSchema, loginSchema, resetPasswordSchema, signupSchema } from "../schemas/auth.schema.js";
import { isEmailServiceConfigured, sendEmailVerificationEmail, sendPasswordResetEmail } from "../services/email.service.js";
import { notifyAuthActivity } from "../services/auth-notification.service.js";
import { clearSessionCookie, issueSession, toAuthUser } from "../utils/session.js";
import { migrateLegacyTasks } from "../utils/migrate-legacy-tasks.js";

const passwordHashRounds = 12;
const frontendUrl = () => (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
const verificationLifetimeMs = 24 * 60 * 60 * 1000;
const emailServiceUnavailableMessage = () => process.env.NODE_ENV === "production"
  ? "Email delivery is temporarily unavailable."
  : "Email verification is unavailable because SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM in backend .env, then restart the server.";

function parseRequestBody(schema, request, response) {
  const result = schema.safeParse(request.body);
  if (result.success) return result.data;

  response.status(400).json({
    error: "Invalid request",
    details: result.error.flatten(),
  });
  return null;
}

export const signupWithEmail = async (request, response) => {
  const input = parseRequestBody(signupSchema, request, response);
  if (!input) return;
  if (!isEmailServiceConfigured()) {
    return response.status(503).json({ error: emailServiceUnavailableMessage() });
  }

  if (input.inviteToken) {
    const invitation = await WorkspaceInvitation.findOne({
      email: input.email,
      tokenHash: createHash("sha256").update(input.inviteToken).digest("hex"),
      status: "pending",
      expiresAt: { $gt: new Date() },
    });
    if (!invitation) return response.status(400).json({ error: "This invitation does not match your email or has expired." });
  }

  const passwordHash = await bcrypt.hash(input.password, passwordHashRounds);
  const verificationToken = randomBytes(32).toString("hex");
  try {
    let user = await User.findOne({ email: input.email }).select("+passwordHash +pendingPasswordHash");
    let isNewUser = false;

    if (user) {
      if (!user.googleId || !user.emailVerified || user.passwordHash || user.pendingPasswordHash) {
        return response.status(409).json({ error: "An account already uses this email." });
      }
      user.pendingPasswordHash = passwordHash;
      user.emailVerificationTokenHash = createHash("sha256").update(verificationToken).digest("hex");
      user.emailVerificationExpiresAt = new Date(Date.now() + verificationLifetimeMs);
      await user.save();
    } else {
      user = await User.create({
        email: input.email,
        name: input.name,
        passwordHash,
        emailVerified: false,
        emailVerificationTokenHash: createHash("sha256").update(verificationToken).digest("hex"),
        emailVerificationExpiresAt: new Date(Date.now() + verificationLifetimeMs),
      });
      isNewUser = true;
    }

    const verificationUrl = new URL("/verify-email", frontendUrl());
    verificationUrl.searchParams.set("token", verificationToken);
    if (input.inviteToken) verificationUrl.searchParams.set("inviteToken", input.inviteToken);
    try {
      await sendEmailVerificationEmail({ email: user.email, name: user.name, verificationUrl: verificationUrl.toString() });
    } catch (error) {
      if (isNewUser) {
        await User.deleteOne({ _id: user._id });
      } else {
        user.pendingPasswordHash = undefined;
        user.emailVerificationTokenHash = undefined;
        user.emailVerificationExpiresAt = undefined;
        await user.save();
      }
      console.error("Verification email delivery failed:", error.message);
      return response.status(503).json({ error: "Verification email could not be sent. Please try again." });
    }
    return response.status(201).json({ message: "Verification email sent. Please verify your email before signing in." });
  } catch (error) {
    if (error.code === 11000) return response.status(409).json({ error: "An account already uses this email." });
    throw error;
  }
};

export const loginWithEmail = async (request, response) => {
  const input = parseRequestBody(loginSchema, request, response);
  if (!input) return;

  const user = await User.findOne({ email: input.email }).select("+passwordHash");
  if (!user?.passwordHash || !(await bcrypt.compare(input.password, user.passwordHash))) {
    return response.status(401).json({ error: "Email or password is incorrect." });
  }
  if (!user.emailVerified) {
    return response.status(403).json({ error: "Please verify your email before signing in. You can request a new verification email." });
  }

  await issueSession(response, user);
  void notifyAuthActivity(user, "sign-in");
  return response.json({ user: toAuthUser(user) });
};

export const refreshSession = async (request, response) => {
  const refreshToken = request.cookies?.refreshToken;
  if (!refreshToken) {
    clearSessionCookie(response);
    return response.status(401).json({ error: "Authentication required" });
  }

  const refreshTokenHash = createHash("sha256").update(refreshToken).digest("hex");
  const user = await User.findOne({
    refreshTokenHash,
    refreshTokenExpiresAt: { $gt: new Date() },
    emailVerified: true,
  });
  if (!user) {
    clearSessionCookie(response);
    return response.status(401).json({ error: "Session expired. Please sign in again." });
  }

  await issueSession(response, user);
  return response.json({ user: toAuthUser(user) });
};

export const verifyEmailAddress = async (request, response) => {
  const input = parseRequestBody(emailVerificationSchema, request, response);
  if (!input) return;

  const emailVerificationTokenHash = createHash("sha256").update(input.token).digest("hex");
  const user = await User.findOne({
    emailVerificationTokenHash,
    emailVerificationExpiresAt: { $gt: new Date() },
  }).select("+emailVerificationTokenHash +pendingPasswordHash");

  if (!user) return response.status(400).json({ error: "This verification link is invalid or expired." });
  user.emailVerified = true;
  if (user.pendingPasswordHash) {
    user.passwordHash = user.pendingPasswordHash;
    user.pendingPasswordHash = undefined;
  }
  user.emailVerificationTokenHash = undefined;
  user.emailVerificationExpiresAt = undefined;
  await user.save();

  const pendingInvitation = await WorkspaceInvitation.findOne({
    email: user.email.toLowerCase(),
    status: "pending",
    expiresAt: { $gt: new Date() },
  });
  let joinedWorkspace = false;
  if (pendingInvitation && !(await WorkspaceMember.exists({ userId: user._id }))) {
    const session = await User.startSession();
    try {
      await session.withTransaction(async () => {
        const invitedWorkspace = await Workspace.findById(pendingInvitation.workspaceId)
          .select("timezone")
          .session(session);
        await WorkspaceMember.create([{
          workspaceId: pendingInvitation.workspaceId,
          userId: user._id,
          role: "member",
        }], { session });
        await migrateLegacyTasks({
          userId: user._id,
          workspaceId: pendingInvitation.workspaceId,
          timezone: invitedWorkspace.timezone,
          session,
        });
        const accepted = await WorkspaceInvitation.findOneAndUpdate(
          { _id: pendingInvitation._id, status: "pending", expiresAt: { $gt: new Date() } },
          { $set: { status: "accepted", acceptedAt: new Date() } },
          { new: true, session }
        );
        if (!accepted) throw new Error("Invitation is no longer pending");
      });
      joinedWorkspace = true;
    } catch (error) {
      if (error.code !== 11000) throw error;
    } finally {
      await session.endSession();
    }
  }

  return response.json({
    message: joinedWorkspace
      ? "Email verified and workspace invitation accepted. You can now sign in."
      : "Email verified. You can now sign in.",
    workspaceJoined: joinedWorkspace,
  });
};

export const resendEmailVerification = async (request, response) => {
  const input = parseRequestBody(emailSchemaInput, request, response);
  if (!input) return;
  if (!isEmailServiceConfigured()) return response.status(503).json({ error: emailServiceUnavailableMessage() });

  const user = await User.findOne({ email: input.email }).select("+pendingPasswordHash");
  if (user && (!user.emailVerified || user.pendingPasswordHash)) {
    const verificationToken = randomBytes(32).toString("hex");
    user.emailVerificationTokenHash = createHash("sha256").update(verificationToken).digest("hex");
    user.emailVerificationExpiresAt = new Date(Date.now() + verificationLifetimeMs);
    await user.save();

    const verificationUrl = new URL("/verify-email", frontendUrl());
    verificationUrl.searchParams.set("token", verificationToken);
    try {
      await sendEmailVerificationEmail({ email: user.email, name: user.name, verificationUrl: verificationUrl.toString() });
    } catch (error) {
      user.emailVerificationTokenHash = undefined;
      user.emailVerificationExpiresAt = undefined;
      await user.save();
      console.error("Verification email delivery failed:", error.message);
      return response.status(503).json({ error: "Verification email could not be sent. Please try again." });
    }
  }

  return response.json({ message: "If an unverified account exists for that email, a verification link will be sent." });
};

export const requestPasswordReset = async (request, response) => {
  const input = parseRequestBody(emailSchemaInput, request, response);
  if (!input) return;
  if (!isEmailServiceConfigured()) {
    return response.status(503).json({ error: emailServiceUnavailableMessage() });
  }

  const user = await User.findOne({ email: input.email }).select("+passwordHash");
  if (user?.passwordHash && user.emailVerified) {
    const resetToken = randomBytes(32).toString("hex");
    user.passwordResetTokenHash = createHash("sha256").update(resetToken).digest("hex");
    user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    const resetUrl = new URL("/set-password", frontendUrl());
    resetUrl.searchParams.set("email", user.email);
    resetUrl.searchParams.set("token", resetToken);
    try {
      await sendPasswordResetEmail({ email: user.email, name: user.name, resetUrl: resetUrl.toString() });
    } catch (error) {
      user.passwordResetTokenHash = undefined;
      user.passwordResetExpiresAt = undefined;
      await user.save();
      console.error("Password reset email delivery failed:", error.message);
    }
  }

  return response.json({ message: "If an account exists for that email, a reset link will be sent." });
};

export const resetPassword = async (request, response) => {
  const input = parseRequestBody(resetPasswordSchema, request, response);
  if (!input) return;

  const passwordResetTokenHash = createHash("sha256").update(input.token).digest("hex");
  const passwordHash = await bcrypt.hash(input.password, passwordHashRounds);
  const user = await User.findOneAndUpdate(
    {
      email: input.email,
      emailVerified: true,
      passwordResetTokenHash,
      passwordResetExpiresAt: { $gt: new Date() },
    },
    {
      $set: { passwordHash },
      $unset: {
        passwordResetTokenHash: 1,
        passwordResetExpiresAt: 1,
        refreshTokenHash: 1,
        refreshTokenExpiresAt: 1,
      },
    },
    { new: true, runValidators: true }
  );

  if (!user) return response.status(400).json({ error: "This password reset link is invalid or expired." });
  clearSessionCookie(response);
  return response.json({ message: "Password updated. Sign in with your new password." });
};