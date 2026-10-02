import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcrypt";
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
