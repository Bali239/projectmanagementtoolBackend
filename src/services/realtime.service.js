import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { getSocketOptions } from "../config/socket.js";
import { configureSockets } from "../sockets/index.js";

let io;
let redisClients = [];
let socketEvents;

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

  io = new Server(server, getSocketOptions({ hasRedisAdapter: Boolean(redisUrl) }));
  if (redisUrl) io.adapter(createAdapter(redisClients[0], redisClients[1]));
  socketEvents = configureSockets(io);
  return io;
}

export function emitTaskListChanged(workspaceId) {
  socketEvents?.emitTaskListChanged(workspaceId);
}

export function emitTaskStatusChanged(workspaceId, change) {
  if (!socketEvents) {
    console.error("Cannot emit task status change before Socket.IO is initialized.", { taskId: change.taskId });
    return;
  }
  socketEvents.emitTaskStatusChanged(workspaceId, change);
}

export function emitWorkspaceMembersChanged(workspaceId) {
  socketEvents?.emitWorkspaceMembersChanged(workspaceId);
}

export async function closeRealtimeServer() {
  if (io) {
    await new Promise((resolve, reject) => {
      io.close((error) => error ? reject(error) : resolve());
    });
    io = undefined;
    socketEvents = undefined;
  }
  await Promise.all(redisClients.map((client) => client.quit()));
  redisClients = [];
}
