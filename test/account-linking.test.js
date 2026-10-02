import assert from "node:assert/strict";
import test from "node:test";
import User from "../src/models/user.model.js";
import { resolveGoogleAccount } from "../src/services/google-account.service.js";

test("Google login links to the existing email user and preserves its task owner ID", async () => {
  const originalFindOne = User.findOne;
  let saved = false;
  const existingUser = {
    _id: "existing-user-id",
    email: "person@example.com",
    name: "Password Account",
    googleId: undefined,
    picture: null,
    emailVerified: false,
    save: async function save() { saved = true; },
  };
  User.findOne = async (filter) => ("googleId" in filter ? null : existingUser);

  try {
    const linkedUser = await resolveGoogleAccount({
      sub: "google-subject-id",
      email: "PERSON@example.com",
      email_verified: true,
      name: "Google Profile",
      picture: "https://example.com/avatar.png",
    });

    assert.equal(linkedUser, existingUser);
    assert.equal(linkedUser._id, "existing-user-id");
    assert.equal(linkedUser.googleId, "google-subject-id");
    assert.equal(linkedUser.emailVerified, true);
    assert.equal(saved, true);
  } finally {
    User.findOne = originalFindOne;
  }
});