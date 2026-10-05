import mongoose from "mongoose";

const workspaceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    photoUrl: {
      type: String,
      default: null,
    },
    photoPublicId: {
      type: String,
      default: null,
      select: false,
    },
    timezone: {
      type: String,
      required: true,
      default: () => process.env.DEFAULT_WORKSPACE_TIMEZONE || "UTC",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true, versionKey: false }
);

const Workspace = mongoose.model("Workspace", workspaceSchema);

export default Workspace;