import jwt from "jsonwebtoken";
import WorkspaceMember from "../models/workspace-member.model.js";
import { allowedOrigins } from "../config/origins.js";
import { workspaceAdminsRoom, workspaceRoom } from "./socket.rooms.js";

export function configureSocketConnection(io) {
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
    const roomName = workspaceRoom(socket.data.workspaceId);
    socket.join(roomName);
    console.log("Socket connected:", socket.id, "pid:", process.pid, "user:", socket.data.userId, "role:", socket.data.role, "transport:", socket.conn.transport.name, "recovered:", socket.recovered);
    socket.conn.on("close", (reason) => {
      console.log("Socket transport closed:", socket.id, "pid:", process.pid, "transport:", socket.conn.transport.name, "reason:", reason);
    });
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
}