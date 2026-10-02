import jwt from "jsonwebtoken";
import { allowedOrigins } from "../config/origins.js";

export const verifyRequestOrigin = (request, response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();

  const origin = request.get("origin");
  if (!origin || !allowedOrigins.has(origin)) {
    return response.status(403).json({ error: "Request origin is not allowed" });
  }
  return next();
};

const authenticateUser = (request, response, next) => {
  try {
    const accessToken = request.cookies?.accessToken;

    if (!accessToken) return response.status(401).json({ error: "Authentication required" });

    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured");

    const verifiedTokenPayload = jwt.verify(
      accessToken,
      process.env.JWT_SECRET
    );

    if (
      typeof verifiedTokenPayload === "string" ||
      !verifiedTokenPayload.userId ||
      verifiedTokenPayload.emailVerified !== true
    ) {
      return response.status(401).json({ error: "Invalid or expired authentication token" });
    }

    request.authenticatedUserId = verifiedTokenPayload.userId;

    next();
  } catch {
    return response.status(401).json({ error: "Invalid or expired authentication token" });
  }
};

export default authenticateUser;