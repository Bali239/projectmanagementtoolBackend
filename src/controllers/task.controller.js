import mongoose from "mongoose";
import Task from "../models/task.model.js";
import TaskStatusEvent from "../models/task-status-event.model.js";
import WorkspaceMember from "../models/workspace-member.model.js";
import { taskInputSchema } from "../schemas/task.schema.js";
import { taskStatusInputSchema } from "../schemas/task-status.schema.js";
import { sendTaskAssignedEmail } from "../services/email.service.js";
import { emitTaskListChanged, emitTaskStatusChanged } from "../services/realtime.service.js";
import { localDueDateToUtc } from "../utils/date-time.js";
import { taskStatusFilter } from "../utils/task-access.js";

async function validateAssignee(assigneeId, workspaceId) {
  if (!assigneeId) return null;
  if (!mongoose.isValidObjectId(assigneeId)) return false;
  const member = await WorkspaceMember.findOne({ userId: assigneeId, workspaceId }).select("userId");
  return member ? assigneeId : false;
}

async function notifyAssignee(task, previousAssigneeId) {
  if (!task.assigneeId || String(task.assigneeId) === String(previousAssigneeId || "")) return;
  const assignedTask = await Task.findById(task._id).populate("assigneeId", "email name");
  if (!assignedTask?.assigneeId?.email) return;
  try {
    await sendTaskAssignedEmail({ task: assignedTask, assignee: assignedTask.assigneeId });
  } catch (error) {
    console.error("Task assignment email failed:", error.message);
  }
}

function toBoardTask(task) {
  const assignee = task.assigneeId?.name ? task.assigneeId : null;
  return {
    id: task._id.toString(),
    title: task.title,
    description: task.description,
    status: task.status,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    assigneeId: assignee?._id?.toString() || task.assigneeId?.toString() || null,
    assignee: assignee ? {
      id: assignee._id.toString(),
      name: assignee.name,
      email: assignee.email,
      picture: assignee.picture,
    } : null,
    createdAt: task.createdAt.toISOString(),
  };
}

function parseTaskInput(request, response) {
  const result = taskInputSchema.safeParse(request.body);
  if (result.success) return result.data;

  response.status(400).json({
    error: "Invalid task",
    details: result.error.flatten(),
  });
  return null;
}

export const listTasks = async (request, response) => {
  const query = typeof request.query.q === "string" ? request.query.q.trim().slice(0, 100) : "";
  const filter = { workspaceId: request.workspace._id };
  if (request.workspaceMembership.role === "member") {
    filter.assigneeId = request.authenticatedUserId;
  }
  if (query) filter.title = { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

  const tasks = await Task.find(filter).populate("assigneeId", "name email picture").sort({ createdAt: -1 }).lean();
  return response.json(tasks.map(toBoardTask));
};

export const listTaskStatusNotifications = async (request, response) => {
  const events = await TaskStatusEvent.find({ workspaceId: request.workspace._id }).sort({ createdAt: -1 }).limit(30).populate("taskId", "title").populate("changedBy", "name").lean();
  return response.json(events.map((event) => ({ id: event._id.toString(), taskTitle: event.taskId?.title || "Deleted task", changedBy: event.changedBy?.name || "A workspace member", fromStatus: event.fromStatus, toStatus: event.toStatus, createdAt: event.createdAt.toISOString() })));
};

export const createTask = async (request, response) => {
  const input = parseTaskInput(request, response);
  if (!input) return;

  const assigneeId = await validateAssignee(input.assigneeId, request.workspace._id);
  if (assigneeId === false) return response.status(400).json({ error: "Assignee must be a member of this workspace." });

  const task = await Task.create({
    ...input,
    dueAt: localDueDateToUtc(input.dueDate, input.dueTime, request.workspace.timezone),
    userId: request.authenticatedUserId,
    workspaceId: request.workspace._id,
  });
  await notifyAssignee(task, null);
  emitTaskListChanged(request.workspace._id);
  return response.status(201).json(toBoardTask(task));
};

export const updateTask = async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.id)) {
    return response.status(400).json({ error: "Invalid task ID" });
  }

  const input = parseTaskInput(request, response);
  if (!input) return;

  const assigneeId = await validateAssignee(input.assigneeId, request.workspace._id);
  if (assigneeId === false) return response.status(400).json({ error: "Assignee must be a member of this workspace." });

  const previousTask = await Task.findOne({ _id: request.params.id, workspaceId: request.workspace._id }).select("assigneeId status");
  if (!previousTask) return response.status(404).json({ error: "Task not found" });

  const task = await Task.findOneAndUpdate(
    { _id: request.params.id, workspaceId: request.workspace._id },
    { $set: { ...input, dueAt: localDueDateToUtc(input.dueDate, input.dueTime, request.workspace.timezone) } },
    { new: true, runValidators: true }
  );
  if (!task) return response.status(404).json({ error: "Task not found" });
  if (previousTask.status !== task.status) {
    await TaskStatusEvent.create({ workspaceId: request.workspace._id, taskId: task._id, changedBy: request.authenticatedUserId, fromStatus: previousTask.status, toStatus: task.status });
    console.log("[TASK STATUS] Database updated", { taskId: task._id.toString(), status: task.status, workspaceId: request.workspace._id.toString() });
    emitTaskStatusChanged(request.workspace._id, {
      taskId: task._id.toString(),
      taskTitle: task.title,
      fromStatus: previousTask.status,
      toStatus: task.status,
    });
  }
  await notifyAssignee(task, previousTask.assigneeId);
  emitTaskListChanged(request.workspace._id);
  return response.json(toBoardTask(task));
};

export const updateTaskStatus = async (request, response) => {
  const taskId = request.params.id;
  const status = request.body?.status;
  console.log("[TASK STATUS] Request received", {
    taskId,
    status,
    userId: request.authenticatedUserId,
    role: request.workspaceMembership?.role,
    workspaceId: request.workspace?._id?.toString(),
  });
  if (!mongoose.isValidObjectId(taskId)) {
    return response.status(400).json({ error: "Invalid task ID" });
  }
  const validation = taskStatusInputSchema.safeParse(request.body);
  if (!validation.success) {
    return response.status(400).json({ error: "Invalid task status", details: validation.error.flatten() });
  }

  const session = await mongoose.startSession();
  let task;
  let statusChanged = false;
  let fromStatus;
  try {
    await session.withTransaction(async () => {
      const taskFilter = taskStatusFilter({
        taskId,
        workspaceId: request.workspace._id,
        userId: request.authenticatedUserId,
        role: request.workspaceMembership.role,
      });

      const existingTask = await Task.findOne(taskFilter).select("status").session(session);
      if (!existingTask) return;
      if (existingTask.status === validation.data.status) {
        task = await Task.findById(existingTask._id).session(session);
        return;
      }
      fromStatus = existingTask.status;

      task = await Task.findOneAndUpdate(
        { ...taskFilter, status: existingTask.status },
        { $set: { status: validation.data.status } },
        { new: true, runValidators: true, session }
      );
      if (!task) throw new Error("Task status changed concurrently. Refresh and try again.");
      console.log("[TASK STATUS] Database updated", {
        taskId: task._id.toString(),
        status: task.status,
        workspaceId: task.workspaceId?.toString() || request.workspace._id.toString(),
      });
      await TaskStatusEvent.create([{ workspaceId: request.workspace._id, taskId: task._id, changedBy: request.authenticatedUserId, fromStatus, toStatus: task.status }], { session });
      statusChanged = true;

    });
  } finally {
    await session.endSession();
  }

  if (!task) return response.status(404).json({ error: "Task not found" });
  if (statusChanged) {
    console.log("[TASK STATUS] Database transaction committed", { taskId: task._id.toString(), status: task.status });
    emitTaskStatusChanged(request.workspace._id, {
      taskId: task._id.toString(),
      taskTitle: task.title,
      fromStatus,
      toStatus: task.status,
    });
    emitTaskListChanged(request.workspace._id);
  }
  const populatedTask = await Task.findById(task._id).populate("assigneeId", "name email picture");
  return response.json(toBoardTask(populatedTask));
};

export const deleteTask = async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.id)) {
    return response.status(400).json({ error: "Invalid task ID" });
  }

  const task = await Task.findOneAndDelete({
    _id: request.params.id,
    workspaceId: request.workspace._id,
  });
  if (!task) return response.status(404).json({ error: "Task not found" });
  emitTaskListChanged(request.workspace._id);
  return response.status(204).end();
};
