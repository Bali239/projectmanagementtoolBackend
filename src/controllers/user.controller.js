import User from "../models/user.model.js";
import { createHash } from "node:crypto";
import { clearSessionCookie, toAuthUser } from "../utils/session.js";
import { notifyAuthActivity } from "../services/auth-notification.service.js";
import jwt from "jsonwebtoken";

export const createRealtimeToken = (request, response) => {
  const token = jwt.sign(
    { userId: request.authenticatedUserId, emailVerified: true },
    process.env.JWT_SECRET,
    { audience: "socket.io", expiresIn: "5m" }
  );
  return response.json({ token });
};

export const getCurrentUser = async (request, response) => {
  try {
    const currentUser = await User.findById(request.authenticatedUserId).select("_id email name picture");

    if (!currentUser) {
      return response.status(404).json({
        message: "User not found",
      });
    }

    return response.json({
      user: toAuthUser(currentUser),
    });
  } catch (error) {
    console.error("Get current user error:", error);

    return response.status(500).json({
      message: "Failed to get current user",
    });
  }
};

export const logoutCurrentUser = async (request, response) => {
  const refreshToken = request.cookies?.refreshToken;
  let user;
  if (refreshToken) {
    const refreshTokenHash = createHash("sha256").update(refreshToken).digest("hex");
    user = await User.findOne({ refreshTokenHash });
    await User.updateOne(
      { refreshTokenHash },
      { $unset: { refreshTokenHash: 1, refreshTokenExpiresAt: 1 } }
    );
  }
  clearSessionCookie(response);
  void notifyAuthActivity(user, "sign-out");

  return response.json({
    message: "Logged out successfully",
  });
};
