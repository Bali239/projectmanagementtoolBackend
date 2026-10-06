import { Router } from "express";
import authenticateUser, { verifyRequestOrigin } from "../middlewares/auth.middleware.js";
import { requireWorkspace, requireWorkspaceAdmin } from "../middlewares/workspace.middleware.js";
import {
  createTask,
  deleteTask,
  listTasks,
  listTaskStatusNotifications,
  updateTaskStatus,
  updateTask,
} from "../controllers/task.controller.js";

const router = Router();

router.use(verifyRequestOrigin, authenticateUser, requireWorkspace);
router.get("/", listTasks);
router.get("/status-notifications", requireWorkspaceAdmin, listTaskStatusNotifications);
router.patch("/:id/status", updateTaskStatus);
router.post("/", requireWorkspaceAdmin, createTask);
router.patch("/:id", requireWorkspaceAdmin, updateTask);
router.delete("/:id", requireWorkspaceAdmin, deleteTask);

export default router;
