import { configureSocketConnection } from "./socket.connection.js";
import { createTaskSocketEvents } from "./socket.tasks.js";
import { createWorkspaceSocketEvents } from "./socket.workspace.js";

export function configureSockets(io) {
  configureSocketConnection(io);
  return {
    ...createTaskSocketEvents(io),
    ...createWorkspaceSocketEvents(io),
  };
}