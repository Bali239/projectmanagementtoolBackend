import WorkspaceMember from "../models/workspace-member.model.js";

export const requireWorkspace = async (request, response, next) => {
  const membership = await WorkspaceMember.findOne({ userId: request.authenticatedUserId })
    .populate("workspaceId");

  if (!membership?.workspaceId) {
    return response.status(409).json({ error: "Create or join a workspace to continue." });
  }

  request.workspaceMembership = membership;
  request.workspace = membership.workspaceId;
  return next();
};

export const requireWorkspaceAdmin = (request, response, next) => {
  if (request.workspaceMembership?.role !== "admin") {
    return response.status(403).json({ error: "Workspace admin access is required." });
  }
  return next();
};