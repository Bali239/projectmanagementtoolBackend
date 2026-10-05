import { Router } from "express";
import {
  handleGoogleOAuthCallback,
  redirectToGoogleAuthorization,
} from "../controllers/google.controller.js";
import authenticateUser from "../middlewares/auth.middleware.js";
import { getCurrentUser, logoutCurrentUser } from "../controllers/user.controller.js";
import { rateLimit } from "express-rate-limit";
import { verifyRequestOrigin } from "../middlewares/auth.middleware.js";
import {
  loginWithEmail,
  refreshSession,
  requestPasswordReset,
  resendEmailVerification,
  resetPassword,
  signupWithEmail,
  verifyEmailAddress,
} from "../controllers/auth.controller.js";

const router = Router();
const rateLimitOptions = { standardHeaders: "draft-8", legacyHeaders: false, validate: { forwardedHeader: false } };
const oauthRateLimit = rateLimit({ ...rateLimitOptions, windowMs: 15 * 60 * 1000, limit: 20 });
const credentialRateLimit = rateLimit({ ...rateLimitOptions, windowMs: 15 * 60 * 1000, limit: 10 });
const resetRateLimit = rateLimit({ ...rateLimitOptions, windowMs: 15 * 60 * 1000, limit: 5 });
const verificationRateLimit = rateLimit({ ...rateLimitOptions, windowMs: 15 * 60 * 1000, limit: 5 });

router.post("/signup", verifyRequestOrigin, credentialRateLimit, signupWithEmail);
router.post("/login", verifyRequestOrigin, credentialRateLimit, loginWithEmail);
router.post("/refresh", verifyRequestOrigin, refreshSession);
router.post("/forgot-password", verifyRequestOrigin, resetRateLimit, requestPasswordReset);
router.post("/reset-password", verifyRequestOrigin, resetRateLimit, resetPassword);
router.post("/verify-email", verifyRequestOrigin, verificationRateLimit, verifyEmailAddress);
router.post("/resend-verification", verifyRequestOrigin, verificationRateLimit, resendEmailVerification);

router.get("/google", oauthRateLimit, redirectToGoogleAuthorization);

router.get("/google/callback", oauthRateLimit, handleGoogleOAuthCallback);

router.get("/me", authenticateUser, getCurrentUser);

router.post("/logout", verifyRequestOrigin, logoutCurrentUser);

export default router;
