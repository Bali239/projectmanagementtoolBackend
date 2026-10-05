import { createHash } from "node:crypto";
import mongoose from "mongoose";
import Task from "../models/task.model.js";
import User from "../models/user.model.js";
import Workspace from "../models/workspace.model.js";
import WorkspaceInvitation from "../models/workspace-invitation.model.js";
import WorkspaceMember from "../models/workspace-member.model.js";
import { createInvitationSchema, createWorkspaceSchema } from "../schemas/workspace.schema.js";
import { WorkspaceInvitationError, createWorkspaceInvitation } from "../services/workspace-invitation.service.js";
import { migrateLegacyTasks } from "../utils/migrate-legacy-tasks.js";
import { parseWorkspaceInvitationCsv, WorkspaceCsvError } from "../utils/workspace-invitation-csv.js";

function parseInput(schema, request, response) {
  const result = schema.safeParse(request.body);
  if (result.success) return result.data;
  response.status(400).json({ error: "Invalid request", details: result.error.flatten() });
  return null;
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function toWorkspace(workspace, role) {
  return {
    id: workspace._id.toString(),
    name: workspace.name,
    timezone: workspace.timezone,
    role,
  };
}

export const getCurrentWorkspace = async (request, response) => {
  const membership = await WorkspaceMember.findOne({ userId: request.authenticatedUserId })
    .populate("workspaceId", "name timezone");
  if (!membership?.workspaceId) return response.json({ workspace: null });
  return response.json({ workspace: toWorkspace(membership.workspaceId, membership.role) });
};

export const createWorkspace = async (request, response) => {
  const input = parseInput(createWorkspaceSchema, request, response);
  if (!input) return;
  if (await WorkspaceMember.exists({ userId: request.authenticatedUserId })) {
    return response.status(409).json({ error: "You already belong to a workspace." });
  }

  const timezone = input.timezone || process.env.DEFAULT_WORKSPACE_TIMEZONE || "UTC";
  const session = await mongoose.startSession();
  let workspace;
  try {
    await session.withTransaction(async () => {
      [workspace] = await Workspace.create([{
        name: input.name,
        timezone,
        createdBy: request.authenticatedUserId,
      }], { session });
      await WorkspaceMember.create([{
        workspaceId: workspace._id,
        userId: request.authenticatedUserId,
        role: "admin",
      }], { session });

      await migrateLegacyTasks({
        userId: request.authenticatedUserId,
        workspaceId: workspace._id,
        timezone,
        session,
      });
    });
  } catch (error) {
    if (error.code === 11000) return response.status(409).json({ error: "You already belong to a workspace." });
    throw error;
  } finally {
    await session.endSession();
  }

  return response.status(201).json({ workspace: toWorkspace(workspace, "admin") });
};

export const listWorkspaceMembers = async (request, response) => {
  const members = await WorkspaceMember.find({ workspaceId: request.workspace._id })
    .populate("userId", "name email picture")
    .sort({ role: 1, createdAt: 1 })
    .lean();
  return response.json(members.map((membership) => ({
    id: membership.userId._id.toString(),
    name: membership.userId.name,
    email: membership.userId.email,
    picture: membership.userId.picture,
    role: membership.role,
    joinedAt: membership.createdAt.toISOString(),
  })));
};

export const removeWorkspaceMember = async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.userId)) {
    return response.status(400).json({ error: "Invalid member ID" });
  }
  if (String(request.params.userId) === String(request.authenticatedUserId)) {
    return response.status(400).json({ error: "You cannot remove yourself from the workspace." });
  }

  const removedMember = await WorkspaceMember.findOneAndDelete({
    workspaceId: request.workspace._id,
    userId: request.params.userId,
    role: "member",
  });
  if (!removedMember) return response.status(404).json({ error: "Workspace member not found." });
  await Task.updateMany(
    { workspaceId: request.workspace._id, assigneeId: request.params.userId },
    { $set: { assigneeId: null } }
  );
  return response.status(204).end();
};

export const listInvitations = async (request, response) => {
  const invitations = await WorkspaceInvitation.find({
    workspaceId: request.workspace._id,
    status: "pending",
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 }).lean();
  return response.json(invitations.map(({ _id, email, expiresAt, createdAt }) => ({
    id: _id.toString(),
    email,
    expiresAt: expiresAt.toISOString(),
    createdAt: createdAt.toISOString(),
  })));
};

export const createInvitation = async (request, response) => {
  const input = parseInput(createInvitationSchema, request, response);
  if (!input) return;
  try {
    const invitation = await createWorkspaceInvitation({
      workspaceId: request.workspace._id,
      inviterId: request.authenticatedUserId,
      email: input.email,
    });
    return response.status(201).json({ invitation });
  } catch (error) {
    if (error instanceof WorkspaceInvitationError) {
      return response.status(error.statusCode).json({ error: error.message });
    }
    throw error;
  }
};

export const importWorkspaceInvitations = async (request, response) => {
  let rows;
  try {
    rows = parseWorkspaceInvitationCsv(request.body);
  } catch (error) {
    if (error instanceof WorkspaceCsvError) return response.status(error.statusCode).json({ error: error.message });
    throw error;
  }

  const results = [];
  for (const row of rows) {
    if (row.status !== "ready") {
      results.push(row);
      continue;
    }

    try {
      await createWorkspaceInvitation({
        workspaceId: request.workspace._id,
        inviterId: request.authenticatedUserId,
        email: row.email,
      });
      results.push({ ...row, status: "sent" });
    } catch (error) {
      if (!(error instanceof WorkspaceInvitationError)) throw error;
      results.push({
        ...row,
        status: error.statusCode === 409 ? "already-member" : "failed",
        message: error.message,
      });
    }
  }

  return response.json({
    results,
    summary: results.reduce((summary, result) => ({
      ...summary,
      [result.status]: summary[result.status] + 1,
    }), { sent: 0, invalid: 0, duplicate: 0, "already-member": 0, failed: 0 }),
  });
};

export const revokeInvitation = async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.invitationId)) {
    return response.status(400).json({ error: "Invalid invitation ID" });
  }
  const invitation = await WorkspaceInvitation.findOneAndUpdate(
    { _id: request.params.invitationId, workspaceId: request.workspace._id, status: "pending" },
    { $set: { status: "revoked" } },
    { new: true }
  );
  if (!invitation) return response.status(404).json({ error: "Pending invitation not found." });
  return response.status(204).end();
};

export const previewInvitation = async (request, response) => {
  const token = request.params.token;
  if (!/^[a-f\d]{64}$/i.test(token)) return response.status(400).json({ error: "Invalid invitation link." });
  const invitation = await WorkspaceInvitation.findOne({
    tokenHash: tokenHash(token),
    status: "pending",
    expiresAt: { $gt: new Date() },
  }).populate("workspaceId", "name").lean();
  if (!invitation?.workspaceId) return response.status(404).json({ error: "This invitation is invalid or expired." });
  return response.json({ invitation: {
    email: invitation.email,
    workspaceName: invitation.workspaceId.name,
  } });
};

export const acceptInvitation = async (request, response) => {
  const token = typeof request.body?.token === "string" ? request.body.token : "";
  if (!/^[a-f\d]{64}$/i.test(token)) return response.status(400).json({ error: "Invalid invitation link." });

  const user = await User.findById(request.authenticatedUserId).select("email emailVerified");
  if (!user?.emailVerified) return response.status(403).json({ error: "Verify your email before accepting this invitation." });
  const invitation = await WorkspaceInvitation.findOne({
    tokenHash: tokenHash(token),
    status: { $in: ["pending", "accepted"] },
  });
  if (!invitation) return response.status(404).json({ error: "This invitation is invalid or expired." });
  if (invitation.email !== user.email.toLowerCase()) {
    return response.status(403).json({ error: "Sign in with the email address this invitation was sent to." });
  }
  const membership = await WorkspaceMember.findOne({ userId: user._id });
  if (invitation.status === "accepted") {
    if (!membership || String(membership.workspaceId) !== String(invitation.workspaceId)) {
      return response.status(409).json({ error: "This invitation was accepted by another workspace membership." });
    }
    const workspace = await Workspace.findById(invitation.workspaceId).select("name timezone");
    return response.json({ workspace: toWorkspace(workspace, membership.role) });
  }
  if (invitation.expiresAt <= new Date()) return response.status(404).json({ error: "This invitation is invalid or expired." });
  if (membership) {
    if (String(membership.workspaceId) === String(invitation.workspaceId)) {
      invitation.status = "accepted";
      invitation.acceptedAt = new Date();
      await invitation.save();
      const workspace = await Workspace.findById(invitation.workspaceId).select("name timezone");
      return response.json({ workspace: toWorkspace(workspace, membership.role) });
    }
    return response.status(409).json({ error: "You already belong to a workspace. Leave it before accepting this invitation." });
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const invitedWorkspace = await Workspace.findById(invitation.workspaceId)
        .select("timezone")
        .session(session);
      await WorkspaceMember.create([{
        workspaceId: invitation.workspaceId,
        userId: user._id,
        role: "member",
      }], { session });
      await migrateLegacyTasks({
        userId: user._id,
        workspaceId: invitation.workspaceId,
        timezone: invitedWorkspace.timezone,
        session,
      });
      const accepted = await WorkspaceInvitation.findOneAndUpdate(
        { _id: invitation._id, status: "pending", expiresAt: { $gt: new Date() } },
        { $set: { status: "accepted", acceptedAt: new Date() } },
        { new: true, session }
      );
      if (!accepted) throw new Error("Invitation is no longer pending.");
    });
  } catch (error) {
    if (error.code === 11000) {
      const [acceptedInvite, acceptedMembership] = await Promise.all([
        WorkspaceInvitation.findOne({ _id: invitation._id, status: "accepted" }),
        WorkspaceMember.findOne({ userId: user._id, workspaceId: invitation.workspaceId }),
      ]);
      if (acceptedInvite && acceptedMembership) {
        const workspace = await Workspace.findById(invitation.workspaceId).select("name timezone");
        return response.json({ workspace: toWorkspace(workspace, acceptedMembership.role) });
      }
      return response.status(409).json({ error: "You already belong to a workspace." });
    }
    throw error;
  } finally {
    await session.endSession();
  }

  const workspace = await Workspace.findById(invitation.workspaceId).select("name timezone");
  return response.json({ workspace: toWorkspace(workspace, "member") });
};