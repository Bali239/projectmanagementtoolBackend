import { z } from "zod";

const timezoneSchema = z.string().trim().refine((timezone) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}, "must be a valid IANA timezone");

const reminderTimesSchema = z.string().refine((value) => {
  const times = value.split(",").map((time) => time.trim());
  return times.length === 2 && new Set(times).size === 2 && times.every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time));
}, "must contain two distinct HH:mm times separated by a comma");

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(5000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MONGODB_URI: z.string().optional(),
  MONGO_URL: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  JWT_SECRET: z.string().min(32),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  REDIS_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  SMTP_SECURE: z.enum(["true", "false"]).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().trim().optional(),
  CLOUDINARY_API_KEY: z.string().trim().optional(),
  CLOUDINARY_API_SECRET: z.string().trim().optional(),
  DEFAULT_WORKSPACE_TIMEZONE: timezoneSchema.default("UTC"),
  OVERDUE_REMINDER_TIMES: reminderTimesSchema.default("09:00,17:00"),
}).refine((env) => env.MONGODB_URI || env.MONGO_URL, {
  message: "MONGODB_URI is required",
  path: ["MONGODB_URI"],
}).refine((env) => {
  const cloudinaryCredentials = [env.CLOUDINARY_CLOUD_NAME, env.CLOUDINARY_API_KEY, env.CLOUDINARY_API_SECRET];
  return cloudinaryCredentials.every(Boolean) || cloudinaryCredentials.every((value) => !value);
}, {
  message: "Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET together.",
  path: ["CLOUDINARY_CLOUD_NAME"],
});

export function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (result.success) return result.data;

  const issues = result.error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid server environment: ${issues}`);
}