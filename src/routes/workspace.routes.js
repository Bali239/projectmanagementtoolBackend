import express, { Router } from "express";
import { rateLimit } from "express-rate-limit";
import authenticateUser, { verifyRequestOrigin } from "../middlewares/auth.middleware.js";
import { requireWorkspace, requireWorkspaceAdmin } from "../middlewares/workspace.middleware.js";
import {
  acceptInvitation,
  createInvitation,
  createWorkspace,
  getCurrentWorkspace,
  importWorkspaceInvitations,
  listInvitations,
  listWorkspaceMembers,
  previewInvitation,
  removeWorkspaceMember,
  revokeInvitation,
} from "../controllers/workspace.controller.js";

const router = Router();
const invitationRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false });

router.get("/current", verifyRequestOrigin, authenticateUser, getCurrentWorkspace);
router.post("/", verifyRequestOrigin, authenticateUser, createWorkspace);
router.get("/invitations/preview/:token", invitationRateLimit, previewInvitation);
router.post("/invitations/accept", verifyRequestOrigin, authenticateUser, acceptInvitation);

router.use(verifyRequestOrigin, authenticateUser, requireWorkspace);
router.get("/members", listWorkspaceMembers);
router.delete("/members/:userId", requireWorkspaceAdmin, removeWorkspaceMember);
router.get("/invitations", requireWorkspaceAdmin, listInvitations);
router.post("/invitations", requireWorkspaceAdmin, invitationRateLimit, createInvitation);
router.post("/invitations/import", requireWorkspaceAdmin, invitationRateLimit, express.text({ type: ["text/csv", "text/plain"], limit: "1mb" }), importWorkspaceInvitations);
router.delete("/invitations/:invitationId", requireWorkspaceAdmin, revokeInvitation);

export default router;