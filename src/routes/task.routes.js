import { Router } from "express";
import authenticateUser, { verifyRequestOrigin } from "../middlewares/auth.middleware.js";
import {
  createTask,
  deleteTask,
  listTasks,
  updateTask,
} from "../controllers/task.controller.js";

const router = Router();

router.use(verifyRequestOrigin, authenticateUser);
router.get("/", listTasks);
router.post("/", createTask);
router.patch("/:id", updateTask);
router.delete("/:id", deleteTask);

export default router;