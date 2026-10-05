export function taskStatusFilter({ taskId, workspaceId, userId, role }) {
  const filter = { _id: taskId, workspaceId };
  if (role === "member") filter.assigneeId = userId;
  return filter;
}