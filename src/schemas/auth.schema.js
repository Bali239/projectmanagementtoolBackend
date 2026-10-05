import { z } from "zod";

const emailSchema = z.string().trim().email("Enter a valid email address.").toLowerCase();

export const passwordSchema = z.string()
  .min(9, "Use at least 9 characters.")
  .regex(/[A-Z]/, "Add at least one uppercase letter.")
  .regex(/[a-z]/, "Add at least one lowercase letter.")
  .regex(/[0-9]/, "Add at least one number.")
  .regex(/[^A-Za-z0-9]/, "Add at least one special character.");

export const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80, "Name is too long."),
  email: emailSchema,
  password: passwordSchema,
  inviteToken: z.string().regex(/^[a-f\d]{64}$/i).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const emailSchemaInput = z.object({ email: emailSchema });
export const emailVerificationSchema = z.object({ token: z.string().length(64) });

export const resetPasswordSchema = z.object({
  email: emailSchema,
  token: z.string().min(32).max(256),
  password: passwordSchema,
});