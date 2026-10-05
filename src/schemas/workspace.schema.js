import { z } from "zod";

const timezoneSchema = z.string().trim().min(1).max(100).refine((timezone) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}, "Enter a valid IANA timezone.");

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  timezone: timezoneSchema.optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
});

export const createInvitationSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
});

export const invitationTokenSchema = z.object({
  token: z.string().regex(/^[a-f\d]{64}$/i),
});