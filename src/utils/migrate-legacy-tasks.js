import Task from "../models/task.model.js";
import { localDueDateToUtc } from "./date-time.js";

export async function migrateLegacyTasks({ userId, workspaceId, timezone, session }) {
  let query = Task.find({ userId, workspaceId: { $exists: false } })
    .select("_id dueDate dueTime");
  if (session) query = query.session(session);
  const tasks = await query.lean();
  if (!tasks.length) return 0;

  const updates = tasks.map((task) => ({
    updateOne: {
      filter: { _id: task._id, workspaceId: { $exists: false } },
      update: { $set: {
        workspaceId,
        assigneeId: userId,
        dueAt: localDueDateToUtc(task.dueDate, task.dueTime, timezone),
      } },
    },
  }));
  await Task.bulkWrite(updates, { ...(session ? { session } : {}) });
  return updates.length;
}