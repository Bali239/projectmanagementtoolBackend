import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
  },
  { timestamps: true, versionKey: false }
);

taskSchema.index({ userId: 1, createdAt: -1 });

const Task = mongoose.model("Task", taskSchema);

export default Task;