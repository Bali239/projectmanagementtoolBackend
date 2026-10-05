import assert from "node:assert/strict";
import test from "node:test";
import WorkspaceMember from "../src/models/workspace-member.model.js";
import Task from "../src/models/task.model.js";
import { requireWorkspace, requireWorkspaceAdmin } from "../src/middlewares/workspace.middleware.js";
import { localDueDateToUtc } from "../src/utils/date-time.js";
import { parseWorkspaceInvitationCsv, WorkspaceCsvError } from "../src/utils/workspace-invitation-csv.js";
import { getLocalReminderSlot } from "../src/services/overdue-task-scheduler.service.js";
import { migrateLegacyTasks } from "../src/utils/migrate-legacy-tasks.js";
import { taskStatusInputSchema } from "../src/schemas/task-status.schema.js";
import { taskStatusFilter } from "../src/utils/task-access.js";
import { taskStatusNotificationCronExpression } from "../src/services/task-status-notification.service.js";
import cron from "node-cron";

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("membership uniqueness enforces one workspace per user", () => {
  const uniqueIndexes = WorkspaceMember.schema.indexes().filter(([, options]) => options.unique);
  assert.ok(uniqueIndexes.some(([keys]) => keys.userId === 1));
});

test("workspace middleware returns onboarding conflict for users without membership", async () => {
  const originalFindOne = WorkspaceMember.findOne;
  WorkspaceMember.findOne = () => ({ populate: async () => null });
  const response = mockResponse();
  let nextCalled = false;
  try {
    await requireWorkspace({ authenticatedUserId: "user-id" }, response, () => { nextCalled = true; });
  } finally {
    WorkspaceMember.findOne = originalFindOne;
  }
  assert.equal(response.statusCode, 409);
  assert.equal(nextCalled, false);
});

test("workspace admin middleware rejects members", () => {
  const response = mockResponse();
  let nextCalled = false;
  requireWorkspaceAdmin({ workspaceMembership: { role: "member" } }, response, () => { nextCalled = true; });
  assert.equal(response.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("CSV import normalizes email, reports invalid rows, and detects duplicates", () => {
  const rows = parseWorkspaceInvitationCsv(
    "Name, EMAIL\nAda, ADA@EXAMPLE.COM \nGrace,ada@example.com\nInvalid,no-at-sign\nBlank,"
  );
  assert.deepEqual(rows.map(({ email, status }) => ({ email, status })), [
    { email: "ada@example.com", status: "ready" },
    { email: "ada@example.com", status: "duplicate" },
    { email: "no-at-sign", status: "invalid" },
    { email: "", status: "invalid" },
  ]);
});

test("CSV import requires an email header and limits batch size", () => {
  assert.throws(() => parseWorkspaceInvitationCsv("name\nAda"), WorkspaceCsvError);
  const oversizedCsv = `email\n${Array.from({ length: 201 }, (_, index) => `user${index}@example.com`).join("\n")}`;
  assert.throws(() => parseWorkspaceInvitationCsv(oversizedCsv), (error) => error.statusCode === 413);
});

test("workspace due dates convert through the configured timezone", () => {
  assert.equal(
    localDueDateToUtc("2026-01-15", "09:30", "America/New_York").toISOString(),
    "2026-01-15T14:30:00.000Z"
  );
  assert.equal(
    localDueDateToUtc("2026-07-15", "09:30", "America/New_York").toISOString(),
    "2026-07-15T13:30:00.000Z"
  );
});

test("legacy tasks migrate to the new workspace and stay assigned to their owner", async () => {
  const originalFind = Task.find;
  const originalBulkWrite = Task.bulkWrite;
  let writes;
  Task.find = () => ({
    select() { return this; },
    async lean() {
      return [{ _id: "task-id", dueDate: "2026-01-15", dueTime: "09:30" }];
    },
  });
  Task.bulkWrite = async (operations, options) => {
    writes = { operations, options };
  };
  try {
    const count = await migrateLegacyTasks({
      userId: "user-id",
      workspaceId: "workspace-id",
      timezone: "America/New_York",
    });
    assert.equal(count, 1);
    assert.deepEqual(writes.operations[0].updateOne.update.$set, {
      workspaceId: "workspace-id",
      assigneeId: "user-id",
      dueAt: new Date("2026-01-15T14:30:00.000Z"),
    });
  } finally {
    Task.find = originalFind;
    Task.bulkWrite = originalBulkWrite;
  }
});

test("reminder schedule slots are evaluated in workspace local time", () => {
  const slot = getLocalReminderSlot(new Date("2026-07-15T13:00:00.000Z"), "America/New_York");
  assert.deepEqual(slot, { date: "2026-07-15", time: "09:00" });
});

test("task status input accepts supported columns and rejects unknown statuses", () => {
  assert.equal(taskStatusInputSchema.safeParse({ status: "in-review" }).success, true);
  assert.equal(taskStatusInputSchema.safeParse({ status: "blocked" }).success, false);
});

test("members can change status only for assigned tasks in their workspace", () => {
  assert.deepEqual(taskStatusFilter({
    taskId: "task-id",
    workspaceId: "workspace-id",
    userId: "member-id",
    role: "member",
  }), {
    _id: "task-id",
    workspaceId: "workspace-id",
    assigneeId: "member-id",
  });
});

test("admins can change status of any task in their workspace", () => {
  assert.deepEqual(taskStatusFilter({
    taskId: "task-id",
    workspaceId: "workspace-id",
    userId: "admin-id",
    role: "admin",
  }), {
    _id: "task-id",
    workspaceId: "workspace-id",
  });
});

test("task status notification cron runs every minute", () => {
  assert.equal(taskStatusNotificationCronExpression, "* * * * *");
  assert.equal(cron.validate(taskStatusNotificationCronExpression), true);
});