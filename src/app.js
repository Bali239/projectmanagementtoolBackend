import express from "express";
import cors from "cors";
import helmet from "helmet";
import authRoutes from "./routes/google.routes.js";
import taskRoutes from "./routes/task.routes.js";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { allowedOrigins } from "./config/origins.js";

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cookieParser());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "32kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }));
app.use("/api/auth", authRoutes);
app.use("/api/tasks", taskRoutes);
app.get("/health", (request, response) => response.json({ status: "ok" }));
app.use((request, response) => response.status(404).json({ error: "Route not found" }));

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  if (error.type === "entity.parse.failed") {
    return response.status(400).json({ error: "Invalid JSON body" });
  }
  console.error("Unhandled request error:", error.message);
  return response.status(500).json({ error: "Internal server error" });
});

export default app;

