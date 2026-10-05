import "dotenv/config";
import mongoose from "mongoose";
import app from "./src/app.js";
import { connectDB } from "./src/config/db.js";
import { loadEnv } from "./src/config/env.js";
import { startOverdueTaskScheduler } from "./src/services/overdue-task-scheduler.service.js";
import { startTaskStatusNotificationScheduler } from "./src/services/task-status-notification.service.js";

const env = loadEnv();

try {
  await connectDB();
  const overdueTaskScheduler = startOverdueTaskScheduler();
  const taskStatusNotificationScheduler = startTaskStatusNotificationScheduler();
  const server = app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT}`);
  });

  const shutdown = () => {
    overdueTaskScheduler.stop();
    taskStatusNotificationScheduler.stop();
    server.close(async (error) => {
      await mongoose.disconnect();
      if (error) {
        console.error("Server shutdown failed:", error.message);
        process.exitCode = 1;
      }
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (error) {
  console.error("Failed to start server:", error.message);
  process.exit(1);
}

