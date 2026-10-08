import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import jwt from "jsonwebtoken";
import WorkspaceMember from "../models/workspace-member.model.js";
import { allowedOrigins } from "../config/origins.js";

let io;
let redisClients = [];

const workspaceRoom = (workspaceId) => `workspace:${workspaceId}`;
const workspaceAdminsRoom = (workspaceId) => `workspace:${workspaceId}:admins`;

export async function attachRealtimeServer(server, redisUrl) {
  if (redisUrl) {
    const publisher = createClient({ url: redisUrl });
    const subscriber = publisher.duplicate();
    publisher.on("error", (error) => console.error("Socket.IO Redis publisher error:", error.message));
    subscriber.on("error", (error) => console.error("Socket.IO Redis subscriber error:", error.message));
    try {
      await Promise.all([publisher.connect(), subscriber.connect()]);
      redisClients = [publisher, subscriber];
    } catch (error) {
      publisher.destroy();
      subscriber.destroy();
      throw new Error(`Could not connect the Socket.IO Redis adapter: ${error.message}`, { cause: error });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.warn("Socket.IO is using its in-memory adapter; configure REDIS_URL before running multiple backend instances.");
  }

  io = new Server(server, {
    ...(!redisUrl && {
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        // Re-run JWT and workspace-membership checks when a disconnected client returns.
        skipMiddlewares: false,
      },
    }),
    cors: {
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        return callback(new Error("Request origin is not allowed"));
      },
      credentials: true,
    },
  });
  if (redisUrl) io.adapter(createAdapter(redisClients[0], redisClients[1]));

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
  return io;
}

export function emitTaskListChanged(workspaceId) {
  io?.to(workspaceRoom(workspaceId)).emit("tasks:changed");
}

export function emitTaskStatusChanged(workspaceId, change) {
  const adminRoomName = workspaceAdminsRoom(workspaceId);
  if (!io) {
    console.error("Cannot emit task status change before Socket.IO is initialized.", { taskId: change.taskId });
    return;
  }
  console.log("[TASK STATUS] About to emit socket event", {
    event: "task_status_changed",
    taskId: change.taskId,
    status: change.toStatus,
    pid: process.pid,
    workspaceId: String(workspaceId),
    room: adminRoomName,
  });
  io.to(adminRoomName).timeout(15000).emit("task_status_changed", change, (error, acknowledgements = []) => {
    const refreshedAdmins = acknowledgements.filter((acknowledgement) =>
      acknowledgement?.boardRefreshed === true && acknowledgement?.notificationsRefreshed === true
    );
    console.log("[TASK STATUS] Admin receipt confirmation", {
      taskId: change.taskId,
      acknowledgedAdmins: acknowledgements.length,
      refreshedAdmins: refreshedAdmins.length,
      acknowledgedAdminSocketIds: acknowledgements.map(({ socketId }) => socketId).filter(Boolean),
      acknowledgementError: error?.message || null,
    });
  });
  console.log("[TASK STATUS] Socket event dispatched", { event: "task_status_changed", taskId: change.taskId });
}

export function emitWorkspaceMembersChanged(workspaceId) {
  io?.to(workspaceRoom(workspaceId)).emit("workspace:members-changed");
}

export async function closeRealtimeServer() {
  if (io) {
    await new Promise((resolve, reject) => {
      io.close((error) => error ? reject(error) : resolve());
    });
    io = undefined;
  }
  await Promise.all(redisClients.map((client) => client.quit()));
  redisClients = [];
}
