import { createHash, randomBytes } from "node:crypto";
import WorkspaceInvitation from "../models/workspace-invitation.model.js";
import WorkspaceMember from "../models/workspace-member.model.js";
import User from "../models/user.model.js";
import Workspace from "../models/workspace.model.js";
import { isEmailServiceConfigured, sendWorkspaceInvitationEmail } from "./email.service.js";

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const frontendUrl = () => (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

export class WorkspaceInvitationError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

function invitationHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createWorkspaceInvitation({ workspaceId, inviterId, email }) {
  if (!isEmailServiceConfigured()) {
    throw new WorkspaceInvitationError("Email delivery is not configured.", 503);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existingUser = await User.findOne({ email: normalizedEmail }).select("_id");
  if (existingUser && await WorkspaceMember.exists({ userId: existingUser._id })) {
    throw new WorkspaceInvitationError("This person already belongs to a workspace.", 409);
  }

  const workspace = await Workspace.findById(workspaceId).select("name");
  const inviter = await User.findById(inviterId).select("name");
  if (!workspace) throw new WorkspaceInvitationError("Workspace not found.", 404);

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + invitationLifetimeMs);
  let invitation = await WorkspaceInvitation.findOne({
    email: normalizedEmail,
    status: "pending",
  });

  if (invitation && String(invitation.workspaceId) !== String(workspaceId)) {
    if (invitation.expiresAt > new Date()) {
      throw new WorkspaceInvitationError("This email already has a pending invitation to another workspace.", 409);
    }
    invitation.status = "expired";
    await invitation.save();
    invitation = null;
  }

  if (invitation) {
    invitation.tokenHash = invitationHash(token);
    invitation.invitedBy = inviterId;
    invitation.expiresAt = expiresAt;
    await invitation.save();
  } else {
    invitation = await WorkspaceInvitation.create({
      workspaceId,
      email: normalizedEmail,
      tokenHash: invitationHash(token),
      invitedBy: inviterId,
      expiresAt,
    });
  }

  const inviteUrl = new URL("/invite", frontendUrl());
  inviteUrl.searchParams.set("token", token);
  try {
    await sendWorkspaceInvitationEmail({
      email: normalizedEmail,
      workspaceName: workspace.name,
      inviterName: inviter?.name || "A workspace admin",
      inviteUrl: inviteUrl.toString(),
      expiresAt,
    });
  } catch (error) {
    await WorkspaceInvitation.updateOne({ _id: invitation._id, tokenHash: invitationHash(token) }, { $set: { status: "revoked" } });
    console.error("Workspace invitation email failed:", error.message);
    throw new WorkspaceInvitationError("Invitation email could not be sent. Please try again.", 503);
  }

  return { id: invitation._id.toString(), email: normalizedEmail, expiresAt: expiresAt.toISOString() };
}