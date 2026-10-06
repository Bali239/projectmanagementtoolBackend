import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import WorkspaceMember from "../models/workspace-member.model.js";
import { allowedOrigins } from "../config/origins.js";

let io;

export function attachRealtimeServer(server) {
  io = new Server(server, {
    cors: {
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        return callback(new Error("Request origin is not allowed"));
      },
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && !allowedOrigins.has(origin)) return next(new Error("Origin is not allowed"));
      const cookies = Object.fromEntries((socket.handshake.headers.cookie || "").split(";").map((part) => {
        const separator = part.indexOf("=");
        return separator < 0 ? ["", ""] : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
      }).filter(([key]) => key));
      const payload = jwt.verify(cookies.accessToken || "", process.env.JWT_SECRET);
      if (typeof payload === "string" || !payload.userId || payload.emailVerified !== true) return next(new Error("Authentication required"));
      const workspaceId = socket.handshake.auth?.workspaceId;
      if (!/^[a-f\d]{24}$/i.test(workspaceId || "")) return next(new Error("Workspace is required"));
      const membership = await WorkspaceMember.exists({ userId: payload.userId, workspaceId });
      if (!membership) return next(new Error("Workspace access denied"));
      socket.data.workspaceId = workspaceId;
      socket.data.userId = payload.userId;
      return next();
    } catch {
      return next(new Error("Authentication required"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`workspace:${socket.data.workspaceId}`);
  });
  return io;
}

export function emitTaskListChanged(workspaceId) {
  io?.to(`workspace:${workspaceId}`).emit("tasks:changed");
}
