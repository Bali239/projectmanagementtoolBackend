import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import WorkspaceMember from "../models/workspace-member.model.js";
import { allowedOrigins } from "../config/origins.js";

let io;

const workspaceRoom = (workspaceId) => `workspace:${workspaceId}`;
const workspaceAdminsRoom = (workspaceId) => `workspace:${workspaceId}:admins`;

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
      const hasRealtimeToken = Object.prototype.hasOwnProperty.call(socket.handshake.auth || {}, "token");
      const payload = hasRealtimeToken
        ? jwt.verify(socket.handshake.auth.token || "", process.env.JWT_SECRET, { audience: "socket.io" })
        : jwt.verify(cookies.accessToken || "", process.env.JWT_SECRET);
      if (typeof payload === "string" || !payload.userId || payload.emailVerified !== true) return next(new Error("Authentication required"));
      const workspaceId = socket.handshake.auth?.workspaceId;
      if (!/^[a-f\d]{24}$/i.test(workspaceId || "")) return next(new Error("Workspace is required"));
      const membership = await WorkspaceMember.findOne({ userId: payload.userId, workspaceId }).select("role");
      if (!membership) return next(new Error("Workspace access denied"));
      socket.data.workspaceId = workspaceId;
      socket.data.userId = payload.userId;
      socket.data.role = membership.role;
      return next();
    } catch {
      return next(new Error("Authentication required"));
    }
  });

  io.on("connection", (socket) => {
    // Rooms are selected by the server only after token and membership checks.
    const roomName = workspaceRoom(socket.data.workspaceId);
    socket.join(roomName);
    console.log("Socket connected:", socket.id, "pid:", process.pid, "user:", socket.data.userId, "role:", socket.data.role);
    console.log("User joined room:", roomName);
    socket.on("disconnect", (reason) => {
      console.log("Socket disconnected:", socket.id, "pid:", process.pid, "reason:", reason);
    });
    if (socket.data.role === "admin") {
      const adminRoomName = workspaceAdminsRoom(socket.data.workspaceId);
      socket.join(adminRoomName);
      console.log("User joined room:", adminRoomName);
    }
  });
  return io;
}

export function emitTaskListChanged(workspaceId) {
  io?.to(workspaceRoom(workspaceId)).emit("tasks:changed");
}

export function emitTaskStatusChanged(workspaceId, change) {
  const roomName = workspaceRoom(workspaceId);
  const socketIds = Array.from(io?.sockets.adapter.rooms.get(roomName) || []);
  console.log("[TASK STATUS] About to emit socket event", {
    event: "task_status_changed",
    taskId: change.taskId,
    status: change.toStatus,
    pid: process.pid,
    workspaceId: String(workspaceId),
    room: roomName,
    recipientSocketIds: socketIds,
  });
  io.to(roomName).emit("task_status_changed", change);
  console.log("[TASK STATUS] Socket event emitted successfully", {
    event: "task_status_changed",
    taskId: change.taskId,
  });
}

export function emitWorkspaceMembersChanged(workspaceId) {
  io?.to(workspaceRoom(workspaceId)).emit("workspace:members-changed");
}
