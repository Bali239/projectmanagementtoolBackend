import WorkspaceMember from "../models/workspace-member.model.js";

export const requireWorkspace = async (request, response, next) => {
  const workspaceId = request.get("X-Workspace-Id");
  if (!workspaceId) {
    return response.status(409).json({ error: "Select a workspace to continue." });
  }
  if (!/^[a-f\d]{24}$/i.test(workspaceId)) {
    return response.status(400).json({ error: "Invalid workspace ID." });
  }

  const membership = await WorkspaceMember.findOne({ userId: request.authenticatedUserId, workspaceId })
    .populate("workspaceId");

  if (!membership?.workspaceId) {
    return response.status(403).json({ error: "You do not belong to the selected workspace." });
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

export const requireWorkspaceCreator = (request, response, next) => {
  if (String(request.workspace?.createdBy) !== String(request.authenticatedUserId)) {
    return response.status(403).json({ error: "Only the workspace creator can edit its details." });
  }
  return next();
};