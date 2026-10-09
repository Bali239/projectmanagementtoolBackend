import assert from "node:assert/strict";
import test from "node:test";
import { getSocketOptions } from "../src/config/socket.js";
import { createTaskSocketEvents } from "../src/sockets/socket.tasks.js";
import { createWorkspaceSocketEvents } from "../src/sockets/socket.workspace.js";

function createMockIO(acknowledgements = []) {
  const emissions = [];
  const roomEmitter = (room, timeout) => ({
    emit(event, ...arguments_) {
      const [payload, acknowledge] = arguments_;
      emissions.push({ room, timeout, event, payload });
      if (typeof acknowledge === "function") acknowledge(null, acknowledgements);
    },
    timeout(milliseconds) {
      return roomEmitter(room, milliseconds);
    },
  });

  return {
    emissions,
    to(room) {
      return roomEmitter(room);
    },
  };
}

test("socket options preserve CORS and Redis-dependent recovery", () => {
  const optionsWithoutRedis = getSocketOptions({ hasRedisAdapter: false });
  assert.deepEqual(optionsWithoutRedis.connectionStateRecovery, {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: false,
  });
  assert.equal(optionsWithoutRedis.cors.credentials, true);
  optionsWithoutRedis.cors.origin(undefined, (error, allowed) => {
    assert.equal(error, null);
    assert.equal(allowed, true);
  });
  optionsWithoutRedis.cors.origin("https://not-allowed.example", (error) => {
    assert.equal(error.message, "Request origin is not allowed");
  });

  const optionsWithRedis = getSocketOptions({ hasRedisAdapter: true });
  assert.equal("connectionStateRecovery" in optionsWithRedis, false);
});

test("task and workspace socket events target their rooms and preserve acknowledgements", () => {
  const acknowledgements = [
    { socketId: "admin-1", boardRefreshed: true, notificationsRefreshed: true },
    { socketId: "admin-2", boardRefreshed: true, notificationsRefreshed: false },
  ];
  const io = createMockIO(acknowledgements);
  const taskEvents = createTaskSocketEvents(io);
  const workspaceEvents = createWorkspaceSocketEvents(io);

  taskEvents.emitTaskListChanged("workspace-id");
  const change = { taskId: "task-id", taskTitle: "Task", fromStatus: "todo", toStatus: "completed" };
  const originalLog = console.log;
  const logs = [];
  console.log = (...arguments_) => logs.push(arguments_);
  try {
    taskEvents.emitTaskStatusChanged("workspace-id", change);
  } finally {
    console.log = originalLog;
  }
  workspaceEvents.emitWorkspaceMembersChanged("workspace-id");

  assert.deepEqual(io.emissions.map(({ room, timeout, event, payload }) => ({ room, timeout, event, payload })), [
    { room: "workspace:workspace-id", timeout: undefined, event: "tasks:changed", payload: undefined },
    { room: "workspace:workspace-id:admins", timeout: 15000, event: "task_status_changed", payload: change },
    { room: "workspace:workspace-id", timeout: undefined, event: "workspace:members-changed", payload: undefined },
  ]);
  const receiptLog = logs.find(([message]) => message === "[TASK STATUS] Admin receipt confirmation")?.[1];
  assert.deepEqual(receiptLog, {
    taskId: "task-id",
    acknowledgedAdmins: 2,
    refreshedAdmins: 1,
    acknowledgedAdminSocketIds: ["admin-1", "admin-2"],
    acknowledgementError: null,
  });
});