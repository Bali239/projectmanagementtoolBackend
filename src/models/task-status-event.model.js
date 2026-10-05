import mongoose from "mongoose";

const taskStatusEventSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
    },
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    fromStatus: {
      type: String,
      enum: ["todo", "in-progress", "in-review", "completed"],
      required: true,
    },
    toStatus: {
      type: String,
      enum: ["todo", "in-progress", "in-review", "completed"],
      required: true,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    processingOwner: {
      type: String,
      default: null,
    },
    processingUntil: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true, versionKey: false }
);

taskStatusEventSchema.index({ workspaceId: 1, processedAt: 1, createdAt: 1 });
taskStatusEventSchema.index({ processingUntil: 1 });

const TaskStatusEvent = mongoose.model("TaskStatusEvent", taskStatusEventSchema);

export default TaskStatusEvent;