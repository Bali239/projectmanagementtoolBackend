import { z } from "zod";

const dateOnlySchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });
const dueDateSchema = dateOnlySchema.nullable().or(z.literal(""));
const dueTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().or(z.literal(""));
const assigneeIdSchema = z.string().regex(/^[a-f\d]{24}$/i).nullable().optional().or(z.literal(""));

export const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.preprocess(
    (value) => typeof value === "string" ? value.trim() : "",
    z.string().max(5000)
  ),
  status: z.enum(["todo", "in-progress", "in-review", "completed"]),
  dueDate: dueDateSchema,
  dueTime: dueTimeSchema,
  assigneeId: assigneeIdSchema,
}).transform((task) => ({
  ...task,
  dueDate: task.dueDate || null,
  dueTime: task.dueDate ? task.dueTime || null : null,
  assigneeId: task.assigneeId || null,
}));