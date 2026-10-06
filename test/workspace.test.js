import assert from "node:assert/strict";
import test from "node:test";
import User from "../src/models/user.model.js";
import WorkspaceMember from "../src/models/workspace-member.model.js";
import Workspace from "../src/models/workspace.model.js";
import Task from "../src/models/task.model.js";
import { requireWorkspace, requireWorkspaceAdmin, requireWorkspaceById, requireWorkspaceCreator } from "../src/middlewares/workspace.middleware.js";
import { localDueDateToUtc } from "../src/utils/date-time.js";
import { parseWorkspaceInvitationCsv, WorkspaceCsvError } from "../src/utils/workspace-invitation-csv.js";
import { getLocalReminderSlot } from "../src/services/overdue-task-scheduler.service.js";
import { migrateLegacyTasks } from "../src/utils/migrate-legacy-tasks.js";
import { taskStatusInputSchema } from "../src/schemas/task-status.schema.js";
import { taskStatusFilter } from "../src/utils/task-access.js";
import { listUserWorkspaces } from "../src/controllers/workspace.controller.js";
import { updateWorkspaceSchema } from "../src/schemas/workspace.schema.js";
import {
  reserveWorkspaceCreation,
  reserveWorkspaceMembership,
  releaseWorkspaceCreation,
  WorkspaceLimitError,
} from "../src/services/workspace-capacity.service.js";

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

test("membership uniqueness is scoped to a workspace and user pair", () => {
  const uniqueIndexes = WorkspaceMember.schema.indexes().filter(([, options]) => options.unique);
  assert.ok(uniqueIndexes.some(([keys]) => keys.workspaceId === 1 && keys.userId === 1));
  assert.equal(uniqueIndexes.some(([keys]) => keys.userId === 1 && Object.keys(keys).length === 1), false);
});

test("workspace list preserves each workspace's membership role", async () => {
  const originalFind = WorkspaceMember.find;
  const originalFindById = User.findById;
  const memberships = [
    { workspaceId: { _id: { toString: () => "workspace-a" }, name: "Alpha", timezone: "UTC", photoUrl: "https://images.example/alpha.png", createdBy: "user-id" }, role: "admin" },
    { workspaceId: { _id: { toString: () => "workspace-b" }, name: "Beta", timezone: "UTC", photoUrl: null, createdBy: "another-user" }, role: "member" },
  ];
  WorkspaceMember.find = () => ({
    populate() { return this; },
    sort: async () => memberships,
  });
  User.findById = () => ({
    select: async () => ({ createdWorkspaceCount: 1, workspaceMembershipCount: 2 }),
  });
  const response = mockResponse();
  try {
    await listUserWorkspaces({ authenticatedUserId: "user-id" }, response);
  } finally {
    WorkspaceMember.find = originalFind;
    User.findById = originalFindById;
  }
  assert.deepEqual(response.body.workspaces.map(({ id, name, role, photoUrl, isCreator }) => ({ id, name, role, photoUrl, isCreator })), [
    { id: "workspace-a", name: "Alpha", role: "admin", photoUrl: "https://images.example/alpha.png", isCreator: true },
    { id: "workspace-b", name: "Beta", role: "member", photoUrl: null, isCreator: false },
  ]);
  assert.deepEqual(response.body.limits, {
    createdCount: 1,
    createdLimit: 3,
    membershipCount: 2,
    membershipLimit: 5,
  });
});

test("workspace creation atomically reserves both created and membership capacity", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  let updateArguments;
  User.findOneAndUpdate = async (...arguments_) => {
    updateArguments = arguments_;
    return { _id: "user-id" };
  };
  try {
    await reserveWorkspaceCreation("user-id", "session");
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
  }
  assert.deepEqual(updateArguments[0], {
    _id: "user-id",
    createdWorkspaceCount: { $lt: 3 },
    workspaceMembershipCount: { $lt: 5 },
  });
  assert.deepEqual(updateArguments[1], { $inc: { createdWorkspaceCount: 1, workspaceMembershipCount: 1 } });
  assert.equal(updateArguments[2].session, "session");
});

test("workspace creation and joining reject users at their respective caps", async () => {
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalFindById = User.findById;
  let counts;
  User.findOneAndUpdate = async () => null;
  User.findById = () => ({
    session() { return this; },
    select: async () => counts,
  });
  try {
    counts = { createdWorkspaceCount: 3, workspaceMembershipCount: 3 };
    await assert.rejects(reserveWorkspaceCreation("user-id", "session"), (error) =>
      error instanceof WorkspaceLimitError && error.limit === "created"
    );
    counts = { createdWorkspaceCount: 2, workspaceMembershipCount: 5 };
    await assert.rejects(reserveWorkspaceMembership("user-id", "session"), (error) =>
      error instanceof WorkspaceLimitError && error.limit === "memberships"
    );
  } finally {
    User.findOneAndUpdate = originalFindOneAndUpdate;
    User.findById = originalFindById;
  }
});

test("workspace middleware rejects a selected workspace without membership", async () => {
  const originalFindOne = WorkspaceMember.findOne;
  WorkspaceMember.findOne = () => ({ populate: async () => null });
  const response = mockResponse();
  let nextCalled = false;
  try {
    await requireWorkspace({ authenticatedUserId: "user-id", get: () => "507f1f77bcf86cd799439011" }, response, () => { nextCalled = true; });
  } finally {
    WorkspaceMember.findOne = originalFindOne;
  }
  assert.equal(response.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("workspace middleware requires an explicit selection", async () => {
  const originalFindOne = WorkspaceMember.findOne;
  let lookupCalled = false;
  WorkspaceMember.findOne = () => { lookupCalled = true; };
  const response = mockResponse();
  try {
    await requireWorkspace({ authenticatedUserId: "user-id", get: () => "" }, response, () => {});
  } finally {
    WorkspaceMember.findOne = originalFindOne;
  }
  assert.equal(response.statusCode, 409);
  assert.equal(lookupCalled, false);
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

test("workspace stores a public photo URL and private Cloudinary asset ID", () => {
  assert.equal(Workspace.schema.path("photoUrl").instance, "String");
  assert.equal(Workspace.schema.path("photoUrl").defaultValue, null);
  assert.equal(Workspace.schema.path("photoPublicId").options.select, false);
});

test("workspace creator middleware only allows the original creator", () => {
  const response = mockResponse();
  let nextCalled = false;
  requireWorkspaceCreator({ workspace: { createdBy: "creator-id" }, authenticatedUserId: "member-id" }, response, () => { nextCalled = true; });
  assert.equal(response.statusCode, 403);
  assert.equal(nextCalled, false);

  requireWorkspaceCreator({ workspace: { createdBy: "creator-id" }, authenticatedUserId: "creator-id" }, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test("workspace update schema validates names but permits photo-only updates", () => {
  assert.equal(updateWorkspaceSchema.safeParse({ name: "  Studio  " }).data.name, "Studio");
  assert.equal(updateWorkspaceSchema.safeParse({}).success, true);
  assert.equal(updateWorkspaceSchema.safeParse({ name: " " }).success, false);
});

test("workspace-ID middleware authorizes only an existing user membership", async () => {
  const originalFindOne = WorkspaceMember.findOne;
  let lookupFilter;
  const membership = { workspaceId: { _id: "workspace-id" }, role: "admin" };
  WorkspaceMember.findOne = (filter) => {
    lookupFilter = filter;
    return { populate: async () => membership };
  };
  const request = { authenticatedUserId: "user-id", params: { workspaceId: "507f1f77bcf86cd799439011" } };
  const response = mockResponse();
  let nextCalled = false;
  try {
    await requireWorkspaceById(request, response, () => { nextCalled = true; });
  } finally {
    WorkspaceMember.findOne = originalFindOne;
  }
  assert.deepEqual(lookupFilter, { userId: "user-id", workspaceId: "507f1f77bcf86cd799439011" });
  assert.equal(request.workspaceMembership, membership);
  assert.equal(request.workspace, membership.workspaceId);
  assert.equal(nextCalled, true);
});

test("deleting a created workspace releases both creator capacity counters", async () => {
  const originalUpdateOne = User.updateOne;
  let updateArguments;
  User.updateOne = async (...arguments_) => {
    updateArguments = arguments_;
    return { modifiedCount: 1 };
  };
  try {
    await releaseWorkspaceCreation("user-id", "session");
  } finally {
    User.updateOne = originalUpdateOne;
  }
  assert.deepEqual(updateArguments[0], {
    _id: "user-id",
    createdWorkspaceCount: { $gt: 0 },
    workspaceMembershipCount: { $gt: 0 },
  });
  assert.deepEqual(updateArguments[1], { $inc: { createdWorkspaceCount: -1, workspaceMembershipCount: -1 } });
  assert.equal(updateArguments[2].session, "session");
});
