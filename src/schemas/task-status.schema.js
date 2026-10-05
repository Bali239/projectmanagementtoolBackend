import { z } from "zod";

export const taskStatusInputSchema = z.object({
  status: z.enum(["todo", "in-progress", "in-review", "completed"]),
});