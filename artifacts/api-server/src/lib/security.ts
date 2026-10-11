import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { User, type UserRole } from "./models";

export const SESSION_COOKIE = "creditsea_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_ISSUER = "creditsea-lms";
const SESSION_AUDIENCE = "creditsea-web";

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be configured with at least 32 characters.");
  }
  return secret;
}

export function createSessionToken(userId: string): string {
  return jwt.sign({}, getSessionSecret(), {
    algorithm: "HS256",
    subject: userId,
    issuer: SESSION_ISSUER,
    audience: SESSION_AUDIENCE,
    expiresIn: "12h",
  });
}

export function setSessionCookie(res: Response, userId: string): void {
  res.cookie(SESSION_COOKIE, createSessionToken(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export function encryptPan(pan: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", panEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(pan, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptPan(value: string): string {
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) {
    throw new Error("Stored PAN ciphertext is invalid.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    panEncryptionKey(),
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function panEncryptionKey(): Buffer {
  return createHash("sha256")
    .update(`${getSessionSecret()}:creditsea-pan-v1`)
    .digest();
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || !token) {
    res.status(401).json({ error: "Sign in to continue.", code: "UNAUTHORIZED" });
    return;
  }

  try {
    const claims = jwt.verify(token, getSessionSecret(), {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });
    if (typeof claims === "string" || !claims.sub) {
      throw new Error("Invalid session claims");
    }

    const user = await User.findById(claims.sub).select(
      "_id name email role status createdAt",
    );
    if (!user) {
      clearSessionCookie(res);
      res
        .status(401)
        .json({ error: "Your session has expired.", code: "UNAUTHORIZED" });
      return;
    }
    if (user.status === "DISABLED") {
      clearSessionCookie(res);
      res.status(401).json({
        error: "This account has been disabled.",
        code: "UNAUTHORIZED",
      });
      return;
    }
    req.currentUser = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status ?? "ACTIVE",
      createdAt: user.createdAt,
    };
    next();
  } catch {
    clearSessionCookie(res);
    res.status(401).json({ error: "Your session is invalid.", code: "UNAUTHORIZED" });
  }
}

export function requireRole(
  ...roles: readonly UserRole[]
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (!req.currentUser) {
      res.status(401).json({ error: "Sign in to continue.", code: "UNAUTHORIZED" });
      return;
    }
    if (!roles.includes(req.currentUser.role)) {
      res.status(403).json({ error: "You do not have access to this area.", code: "FORBIDDEN" });
      return;
    }
    next();
  };
}

export function enforceSameOriginForCookieWrites(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }
  if (!req.cookies?.[SESSION_COOKIE]) {
    next();
    return;
  }

  const origin = req.get("origin");
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host");
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || req.protocol;

  if (!origin || !host) {
    res.status(403).json({ error: "Request origin could not be verified.", code: "CSRF_REJECTED" });
    return;
  }
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.host !== host || parsedOrigin.protocol !== `${protocol}:`) {
      res.status(403).json({ error: "Request origin could not be verified.", code: "CSRF_REJECTED" });
      return;
    }
  } catch {
    res.status(403).json({ error: "Request origin could not be verified.", code: "CSRF_REJECTED" });
    return;
  }
  next();
}
