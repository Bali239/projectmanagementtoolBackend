import mongoose from "mongoose";
import Task from "../models/task.model.js";
import TaskStatusEvent from "../models/task-status-event.model.js";
import User from "../models/user.model.js";
import Workspace from "../models/workspace.model.js";
import WorkspaceInvitation from "../models/workspace-invitation.model.js";
import WorkspaceMember from "../models/workspace-member.model.js";
import JobLock from "../models/job-lock.model.js";

export const connectDB = async () => {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!mongoUri) {
    throw new Error("MONGODB_URI is not set in the environment");
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10_000 });
  const indexes = await User.collection.indexes().catch(() => []);
  const legacyGoogleIdIndex = indexes.find(
    (index) => index.key?.googleId === 1 && index.unique && !index.sparse
  );
  if (legacyGoogleIdIndex) await User.collection.dropIndex(legacyGoogleIdIndex.name);
  await Promise.all([
    User.init(),
    Task.init(),
    TaskStatusEvent.init(),
    Workspace.init(),
    WorkspaceMember.init(),
    WorkspaceInvitation.init(),
    JobLock.init(),
  ]);
  console.log("MongoDB connected");
};


