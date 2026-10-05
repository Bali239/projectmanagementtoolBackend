import assert from "node:assert/strict";
import test from "node:test";
import { taskInputSchema } from "../src/schemas/task.schema.js";

test("task input trims text and normalizes empty due fields", () => {
  const result = taskInputSchema.safeParse({
    title: "  Prepare release  ",
    description: "  Check deployment  ",
    status: "todo",
    dueDate: "",
    dueTime: "09:30",
    assigneeId: "",
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    title: "Prepare release",
    description: "Check deployment",
    status: "todo",
    dueDate: null,
    dueTime: null,
    assigneeId: null,
  });
});

test("task input rejects invalid status, date, and time values", () => {
  const result = taskInputSchema.safeParse({
    title: "Task",
    description: "",
    status: "blocked",
    dueDate: "2026-02-30",
    dueTime: "25:00",
  });

  assert.equal(result.success, false);
});

test("task input rejects blank and overlong titles", () => {
  const base = { description: "", status: "todo", dueDate: null, dueTime: null };
  assert.equal(taskInputSchema.safeParse({ ...base, title: "  " }).success, false);
  assert.equal(taskInputSchema.safeParse({ ...base, title: "x".repeat(161) }).success, false);
});