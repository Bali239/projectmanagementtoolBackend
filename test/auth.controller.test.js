import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import bcrypt from "bcrypt";
import app from "../src/app.js";
import { allowedOrigins } from "../src/config/origins.js";
import User from "../src/models/user.model.js";
import { loginWithEmail, signupWithEmail } from "../src/controllers/auth.controller.js";

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    cookies: [],
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    cookie(...cookie) {
      this.cookies.push(cookie);
      return this;
    },
  };
}

test("unverified email login is rejected without issuing session cookies", async () => {
  const originalFindOne = User.findOne;
  const passwordHash = await bcrypt.hash("SecurePass1!", 4);
  User.findOne = () => ({
    select: async () => ({ email: "person@example.com", passwordHash, emailVerified: false }),
  });
  const response = createResponse();

  try {
    await loginWithEmail({ body: { email: "person@example.com", password: "SecurePass1!" } }, response);
    assert.equal(response.statusCode, 403);
    assert.match(response.body.error, /verify your email/i);
    assert.equal(response.cookies.length, 0);
  } finally {
    User.findOne = originalFindOne;
  }
});

test("signup does not create a user or session when verification email is unavailable", async () => {
  const smtpKeys = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"];
  const originals = new Map(smtpKeys.map((key) => [key, process.env[key]]));
  for (const key of smtpKeys) delete process.env[key];
  const response = createResponse();

  try {
    await signupWithEmail({
      body: { name: "Test User", email: "person@example.com", password: "SecurePass1!" },
    }, response);
    assert.equal(response.statusCode, 503);
    assert.match(response.body.error, /verification/i);
    assert.equal(response.cookies.length, 0);
  } finally {
    for (const [key, value] of originals) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("POST /api/auth/refresh rotates a valid refresh session", async () => {
  const originalFindOne = User.findOne;
  const originalJwtSecret = process.env.JWT_SECRET;
  const refreshToken = "existing-refresh-token";
  const refreshTokenHash = createHash("sha256").update(refreshToken).digest("hex");
  const user = {
    _id: { toString: () => "user-123" },
    email: "person@example.com",
    name: "Test User",
    picture: null,
    emailVerified: true,
    refreshTokenHash,
    refreshTokenExpiresAt: new Date(Date.now() + 60_000),
    async save() {},
  };
  User.findOne = async (query) => {
    assert.equal(query.refreshTokenHash, refreshTokenHash);
    assert.equal(query.emailVerified, true);
    assert.ok(query.refreshTokenExpiresAt.$gt instanceof Date);
    return user;
  };
  process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-characters";

  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/refresh`, {
      method: "POST",
      headers: {
        cookie: `refreshToken=${refreshToken}`,
        origin: [...allowedOrigins][0],
      },
    });
    const responseBody = await response.json();
    const setCookie = response.headers.get("set-cookie") || "";

    assert.equal(response.status, 200);
    assert.deepEqual(responseBody.user, {
      uid: "user-123",
      email: "person@example.com",
      displayName: "Test User",
      photoURL: null,
    });
    assert.notEqual(user.refreshTokenHash, refreshTokenHash);
    assert.match(setCookie, /accessToken=/);
    assert.match(setCookie, /refreshToken=.*Path=\/api\/auth/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    User.findOne = originalFindOne;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  }
});
