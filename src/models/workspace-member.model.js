import mongoose from "mongoose";

const workspaceMemberSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["admin", "member"],
      required: true,
      default: "member",
    },
  },
  { timestamps: true, versionKey: false }
);

workspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
workspaceMemberSchema.index({ userId: 1, workspaceId: 1 });
workspaceMemberSchema.index({ workspaceId: 1, createdAt: 1 });

const WorkspaceMember = mongoose.model("WorkspaceMember", workspaceMemberSchema);

export default WorkspaceMember;