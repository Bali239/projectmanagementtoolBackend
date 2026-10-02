import "dotenv/config";
import mongoose from "mongoose";
import app from "./src/app.js";
import { connectDB } from "./src/config/db.js";
import { loadEnv } from "./src/config/env.js";

const env = loadEnv();

try {
  await connectDB();
  const server = app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT}`);
  });

  const shutdown = () => {
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

