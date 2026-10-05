import User from "../models/user.model.js";

export const workspaceLimits = {
  created: 3,
  memberships: 5,
};

export class WorkspaceLimitError extends Error {
  constructor(limit, message) {
    super(message);
    this.limit = limit;
    this.statusCode = 409;
  }
}

async function reserveCapacity(userId, increments, session) {
  const filter = { _id: userId };
  for (const field of Object.keys(increments)) {
    filter[field] = { $lt: workspaceLimits[field === "createdWorkspaceCount" ? "created" : "memberships"] };
  }

  const user = await User.findOneAndUpdate(filter, { $inc: increments }, { new: true, session });
  if (user) return user;

  const currentUser = await User.findById(userId).session(session)
    .select("createdWorkspaceCount workspaceMembershipCount");
  if (increments.createdWorkspaceCount && currentUser?.createdWorkspaceCount >= workspaceLimits.created) {
    throw new WorkspaceLimitError("created", "You have reached the limit of 3 workspaces you can create.");
  }
  throw new WorkspaceLimitError("memberships", "You can belong to a maximum of 5 workspaces.");
}

export function reserveWorkspaceCreation(userId, session) {
  return reserveCapacity(userId, {
    createdWorkspaceCount: 1,
    workspaceMembershipCount: 1,
  }, session);
}

export function reserveWorkspaceMembership(userId, session) {
  return reserveCapacity(userId, { workspaceMembershipCount: 1 }, session);
}

export async function releaseWorkspaceMembership(userId, session) {
  const result = await User.updateOne(
    { _id: userId, workspaceMembershipCount: { $gt: 0 } },
    { $inc: { workspaceMembershipCount: -1 } },
    { session }
  );
  if (result.modifiedCount !== 1) throw new Error("Workspace membership count could not be updated.");
}