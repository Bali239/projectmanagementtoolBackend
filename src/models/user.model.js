import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    googleId: {
      type: String,
      unique: true,
      sparse: true,
      default: undefined,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    picture: {
      type: String,
      default: null,
    },
    passwordHash: {
      type: String,
      default: null,
      select: false,
    },
    pendingPasswordHash: {
      type: String,
      select: false,
    },
    emailVerified: {
      type: Boolean,
      default: false,
      required: true,
    },
    emailVerificationTokenHash: {
      type: String,
      unique: true,
      sparse: true,
      select: false,
    },
    emailVerificationExpiresAt: {
      type: Date,
      select: false,
    },
    refreshTokenHash: {
      type: String,
      unique: true,
      sparse: true,
      select: false,
    },
    refreshTokenExpiresAt: {
      type: Date,
      select: false,
    },
    passwordResetTokenHash: {
      type: String,
      select: false,
    },
    passwordResetExpiresAt: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model("User", userSchema);

export default User;