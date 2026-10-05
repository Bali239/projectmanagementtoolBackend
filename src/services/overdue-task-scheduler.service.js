import { randomUUID } from "node:crypto";
import cron from "node-cron";
import JobLock from "../models/job-lock.model.js";
import Task from "../models/task.model.js";
import Workspace from "../models/workspace.model.js";
import WorkspaceMember from "../models/workspace-member.model.js";
import { sendOverdueTaskEmail } from "./email.service.js";

const leaseDurationMs = 10 * 60 * 1000;

function configuredReminderTimes() {
  const times = (process.env.OVERDUE_REMINDER_TIMES || "09:00,17:00")
    .split(",")
    .map((time) => time.trim());
  return times.filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time));
}

export function getLocalReminderSlot(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

async function acquireLease(key) {
  const now = new Date();
  const owner = randomUUID();
  const existing = await JobLock.findOneAndUpdate(
    { _id: key, completed: false, leaseUntil: { $lte: now } },
    { $set: { owner, leaseUntil: new Date(now.getTime() + leaseDurationMs), expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) } },
    { new: true }
  );
  if (existing) return owner;

  try {
    await JobLock.create({
      _id: key,
      owner,
      leaseUntil: new Date(now.getTime() + leaseDurationMs),
      completed: false,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    });
    return owner;
  } catch (error) {
    if (error.code === 11000) return null;
    throw error;
  }
}

async function notifyWorkspaceOverdueTasks(workspace, slot) {
  const lockKey = `overdue:${workspace._id}:${slot.date}:${slot.time}`;
  const leaseOwner = await acquireLease(lockKey);
  if (!leaseOwner) return;

  try {
    const [tasks, admins] = await Promise.all([
      Task.find({
        workspaceId: workspace._id,
        status: { $ne: "completed" },
        dueAt: { $type: "date", $lte: new Date() },
        assigneeId: { $ne: null },
      }).populate("assigneeId", "name email").lean(),
      WorkspaceMember.find({ workspaceId: workspace._id, role: "admin" })
        .populate("userId", "name email")
        .lean(),
    ]);

    const recipientsByTask = tasks.map((task) => {
      const recipients = new Map();
      if (task.assigneeId?.email) recipients.set(task.assigneeId.email, task.assigneeId);
      for (const admin of admins) {
        if (admin.userId?.email) recipients.set(admin.userId.email, admin.userId);
      }
      return { task, recipients: [...recipients.values()] };
    });

    for (const { task, recipients } of recipientsByTask) {
      for (const recipient of recipients) {
        try {
          await sendOverdueTaskEmail({
            task,
            recipient,
            assigneeName: task.assigneeId?.name,
            workspaceName: workspace.name,
          });
        } catch (error) {
          console.error(`Overdue email failed for ${recipient.email}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error(`Overdue task reminders failed for workspace ${workspace._id}:`, error.message);
  } finally {
    await JobLock.updateOne(
      { _id: lockKey, owner: leaseOwner },
      { $set: { completed: true, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } }
    );
  }
}

export async function runOverdueTaskReminderCheck(now = new Date()) {
  const workspaces = await Workspace.find({}).select("_id name timezone").lean();
  const reminderTimes = new Set(configuredReminderTimes());
  const dueWorkspaces = workspaces.filter((workspace) => {
    const slot = getLocalReminderSlot(now, workspace.timezone);
    return reminderTimes.has(slot.time);
  });

  await Promise.all(dueWorkspaces.map((workspace) =>
    notifyWorkspaceOverdueTasks(workspace, getLocalReminderSlot(now, workspace.timezone))
  ));
}

export function startOverdueTaskScheduler() {
  const scheduledTask = cron.schedule("* * * * *", () => {
    void runOverdueTaskReminderCheck().catch((error) => {
      console.error("Overdue task scheduler failed:", error.message);
    });
  }, { timezone: "UTC" });
  return scheduledTask;
}