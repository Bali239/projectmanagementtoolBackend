import mongoose from "mongoose";

const workspaceInvitationSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "revoked", "expired"],
      required: true,
      default: "pending",
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true, versionKey: false }
);

workspaceInvitationSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);
workspaceInvitationSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });
workspaceInvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const WorkspaceInvitation = mongoose.model("WorkspaceInvitation", workspaceInvitationSchema);

export default WorkspaceInvitation;