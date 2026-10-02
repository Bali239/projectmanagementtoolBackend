import assert from "node:assert/strict";
import test from "node:test";
import { emailVerificationSchema, loginSchema, resetPasswordSchema, signupSchema } from "../src/schemas/auth.schema.js";
import { issueSession } from "../src/utils/session.js";
import jwt from "jsonwebtoken";

test("signup normalizes the email and trims the display name", () => {
  const result = signupSchema.safeParse({
    name: "  Taylor Reed  ",
    email: "  TAYLOR@example.com ",
    password: "SecurePass1!",
  });

  assert.equal(result.success, true);
  assert.equal(result.data.name, "Taylor Reed");
  assert.equal(result.data.email, "taylor@example.com");
});

test("signup rejects passwords missing any required character category", () => {
  const base = { name: "Taylor Reed", email: "taylor@example.com" };
  for (const password of ["lowercase1!", "UPPERCASE1!", "NoNumber!!", "NoSpecial123", "Short1!"]) {
    assert.equal(signupSchema.safeParse({ ...base, password }).success, false, password);
  }
});

test("login does not apply signup strength rules to existing passwords", () => {
  const result = loginSchema.safeParse({ email: " USER@example.com ", password: "LegacyPass" });
  assert.equal(result.success, true);
  assert.equal(result.data.email, "user@example.com");
});

test("reset payload requires a token and a policy-compliant password", () => {
  const base = { email: "user@example.com", token: "a".repeat(64) };
  assert.equal(resetPasswordSchema.safeParse({ ...base, password: "SecurePass1!" }).success, true);
  assert.equal(resetPasswordSchema.safeParse({ ...base, password: "weak" }).success, false);
});

test("email verification tokens must have the expected opaque-token length", () => {
  assert.equal(emailVerificationSchema.safeParse({ token: "a".repeat(64) }).success, true);
  assert.equal(emailVerificationSchema.safeParse({ token: "short" }).success, false);
});

test("session issuance stores only a refresh-token hash and creates a short access token", async () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-jwt-secret-that-is-long-enough-to-use";
  const user = { _id: "user-id", save: async () => {} };
  const cookies = new Map();
  const response = { cookie: (name, value, options) => cookies.set(name, { value, options }) };

  try {
    await issueSession(response, user);
    const accessCookie = cookies.get("accessToken");
    const refreshCookie = cookies.get("refreshToken");
    const accessPayload = jwt.verify(accessCookie.value, process.env.JWT_SECRET);

    assert.equal(accessPayload.userId, user._id);
    assert.equal(accessPayload.emailVerified, true);
    assert.equal(accessPayload.exp - accessPayload.iat, 15 * 60);
    assert.equal(refreshCookie.options.maxAge, 7 * 24 * 60 * 60 * 1000);
    assert.equal(user.refreshTokenHash.length, 64);
    assert.notEqual(user.refreshTokenHash, refreshCookie.value);
  } finally {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});