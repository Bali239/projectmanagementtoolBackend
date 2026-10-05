import { randomUUID } from "node:crypto";
import cron from "node-cron";
import TaskStatusEvent from "../models/task-status-event.model.js";
import WorkspaceMember from "../models/workspace-member.model.js";
import { sendTaskStatusChangedEmail } from "./email.service.js";

const eventLeaseMs = 2 * 60 * 1000;
export const taskStatusNotificationCronExpression = "* * * * *";

export async function processTaskStatusEvents(batchSize = 100) {
  const pendingEvents = await TaskStatusEvent.find({ processedAt: null })
    .sort({ createdAt: 1 })
    .limit(batchSize)
    .select("_id");

  for (const pendingEvent of pendingEvents) {
    const owner = randomUUID();
    const now = new Date();
    const event = await TaskStatusEvent.findOneAndUpdate(
      {
        _id: pendingEvent._id,
        processedAt: null,
        $or: [
          { processingUntil: null },
          { processingUntil: { $lte: now } },
        ],
      },
      { $set: { processingOwner: owner, processingUntil: new Date(now.getTime() + eventLeaseMs) } },
      { new: true }
    ).populate("taskId", "title").populate("changedBy", "name email").populate("workspaceId", "name");
    if (!event) continue;

    try {
      const admins = await WorkspaceMember.find({ workspaceId: event.workspaceId._id, role: "admin" })
        .populate("userId", "name email")
        .lean();
      for (const { userId } of admins) {
        if (!userId?.email) continue;
        await sendTaskStatusChangedEmail({
          task: event.taskId,
          recipient: userId,
          changedBy: event.changedBy,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          workspaceName: event.workspaceId.name,
        });
      }
      await TaskStatusEvent.updateOne(
        { _id: event._id, processingOwner: owner, processedAt: null },
        { $set: { processedAt: new Date() }, $unset: { processingOwner: 1, processingUntil: 1 } }
      );
    } catch (error) {
      console.error(`Task status notification failed for event ${event._id}:`, error.message);
      await TaskStatusEvent.updateOne(
        { _id: event._id, processingOwner: owner, processedAt: null },
        { $unset: { processingOwner: 1, processingUntil: 1 } }
      );
    }
  }
}

export function startTaskStatusNotificationScheduler() {
  const scheduledTask = cron.schedule(taskStatusNotificationCronExpression, () => {
    void processTaskStatusEvents().catch((error) => {
      console.error("Task status notification job failed:", error.message);
    });
  }, { timezone: "UTC" });
  return scheduledTask;
}