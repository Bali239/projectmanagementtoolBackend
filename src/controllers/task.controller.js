import mongoose from "mongoose";
import Task from "../models/task.model.js";
import { taskInputSchema } from "../schemas/task.schema.js";

function toBoardTask(task) {
  return {
    id: task._id.toString(),
    title: task.title,
    description: task.description,
    status: task.status,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
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
  const filter = { userId: request.authenticatedUserId };
  if (query) filter.title = { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

  const tasks = await Task.find(filter).sort({ createdAt: -1 }).lean();
  return response.json(tasks.map(toBoardTask));
};

export const createTask = async (request, response) => {
  const input = parseTaskInput(request, response);
  if (!input) return;

  const task = await Task.create({ ...input, userId: request.authenticatedUserId });
  return response.status(201).json(toBoardTask(task));
};

export const updateTask = async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.id)) {
    return response.status(400).json({ error: "Invalid task ID" });
  }

  const input = parseTaskInput(request, response);
  if (!input) return;

  const task = await Task.findOneAndUpdate(
    { _id: request.params.id, userId: request.authenticatedUserId },
    { $set: input },
    { new: true, runValidators: true }
  );
  if (!task) return response.status(404).json({ error: "Task not found" });
  return response.json(toBoardTask(task));
};

export const deleteTask = async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.id)) {
    return response.status(400).json({ error: "Invalid task ID" });
  }

  const task = await Task.findOneAndDelete({
    _id: request.params.id,
    userId: request.authenticatedUserId,
  });
  if (!task) return response.status(404).json({ error: "Task not found" });
  return response.status(204).end();
};