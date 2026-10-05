import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
    },
    assigneeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    description: {
      type: String,
      default: "",
      maxlength: 5000,
    },
    status: {
      type: String,
      enum: ["todo", "in-progress", "in-review", "completed"],
      default: "todo",
      required: true,
    },
    dueDate: {
      type: String,
      default: null,
    },
    dueTime: {
      type: String,
      default: null,
    },
    dueAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true, versionKey: false }
);

taskSchema.index({ workspaceId: 1, createdAt: -1 });
taskSchema.index({ workspaceId: 1, assigneeId: 1, status: 1, createdAt: -1 });
taskSchema.index({ workspaceId: 1, dueAt: 1, status: 1 });

const Task = mongoose.model("Task", taskSchema);

export default Task;