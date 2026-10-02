export const allowedOrigins = new Set(
  [
    process.env.FRONTEND_URL || "http://localhost:3000",
    ...(process.env.CORS_ALLOWED_ORIGINS || "").split(","),
  ]
    .map((origin) => origin.trim())
    .filter(Boolean)
);