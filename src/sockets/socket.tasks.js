import { workspaceAdminsRoom, workspaceRoom } from "./socket.rooms.js";

export function createTaskSocketEvents(io) {
  return {
    emitTaskListChanged(workspaceId) {
      io.to(workspaceRoom(workspaceId)).emit("tasks:changed");
    },

    emitTaskStatusChanged(workspaceId, change) {
      const adminRoomName = workspaceAdminsRoom(workspaceId);
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
    },
  };
}