import User from "../models/user.model.js";
import Workspace from "../models/workspace.model.js";
import WorkspaceMember from "../models/workspace-member.model.js";

export async function migrateWorkspaceMemberships() {
  const indexes = await WorkspaceMember.collection.indexes().catch(() => []);
  const legacyIndex = indexes.find((index) =>
    index.unique && index.key?.userId === 1 && Object.keys(index.key).length === 1
  );
  if (legacyIndex) await WorkspaceMember.collection.dropIndex(legacyIndex.name);

  const usersNeedingCounts = await User.collection.find({
    $or: [
      { createdWorkspaceCount: { $exists: false } },
      { workspaceMembershipCount: { $exists: false } },
    ],
  }, { projection: { _id: 1 } }).toArray();
  if (!usersNeedingCounts.length) return;

  const userIds = new Set(usersNeedingCounts.map(({ _id }) => String(_id)));
  const createdCounts = new Map();
  const membershipCounts = new Map();
  const workspaces = await Workspace.collection.find({}, { projection: { createdBy: 1 } }).toArray();
  const memberships = await WorkspaceMember.collection.find({}, { projection: { userId: 1 } }).toArray();

  for (const workspace of workspaces) {
    const id = String(workspace.createdBy);
    if (userIds.has(id)) createdCounts.set(id, (createdCounts.get(id) || 0) + 1);
  }
  for (const membership of memberships) {
    const id = String(membership.userId);
    if (userIds.has(id)) membershipCounts.set(id, (membershipCounts.get(id) || 0) + 1);
  }

  await User.collection.bulkWrite(usersNeedingCounts.map(({ _id }) => ({
    updateOne: {
      filter: {
        _id,
        $or: [
          { createdWorkspaceCount: { $exists: false } },
          { workspaceMembershipCount: { $exists: false } },
        ],
      },
      update: {
        $set: {
          createdWorkspaceCount: createdCounts.get(String(_id)) || 0,
          workspaceMembershipCount: membershipCounts.get(String(_id)) || 0,
        },
      },
    },
  })));
}