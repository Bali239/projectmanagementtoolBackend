import { createHash, randomBytes } from "node:crypto";
import createAccessToken from "./createToken.js";

const isProduction = process.env.NODE_ENV === "production";
const cookieOptions = (path, maxAge) => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  maxAge,
  path,
});

export async function issueSession(response, user) {
  const refreshToken = randomBytes(48).toString("hex");
  user.refreshTokenHash = createHash("sha256").update(refreshToken).digest("hex");
  user.refreshTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await user.save();

  response.cookie("accessToken", createAccessToken(user._id), {
    ...cookieOptions("/", 15 * 60 * 1000),
  });
  response.cookie("refreshToken", refreshToken, cookieOptions("/api/auth", 7 * 24 * 60 * 60 * 1000));
}

export function clearSessionCookie(response) {
  response.clearCookie("accessToken", cookieOptions("/"));
  response.clearCookie("refreshToken", cookieOptions("/api/auth"));
}

export function toAuthUser(user) {
  return {
    uid: user._id.toString(),
    email: user.email,
    displayName: user.name,
    photoURL: user.picture,
  };
}