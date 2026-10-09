import { workspaceRoom } from "./socket.rooms.js";

export function createWorkspaceSocketEvents(io) {
  return {
    emitWorkspaceMembersChanged(workspaceId) {
      io.to(workspaceRoom(workspaceId)).emit("workspace:members-changed");
    },
  };
}