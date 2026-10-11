import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import {
  GetCurrentUserResponse,
  LogInBody,
  LogInResponse,
  LogOutResponse,
  SignUpBody,
  SignUpResponse,
} from "@workspace/api-zod";
import { HttpError } from "../lib/errors";
import { User } from "../lib/models";
import {
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
} from "../lib/security";
import { userDto } from "../lib/dto";
import { validate } from "../lib/validation";

const router = Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many sign-in attempts. Wait a few minutes and try again.",
    code: "RATE_LIMITED",
  },
});
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many accounts were created from this network. Try again later.",
    code: "RATE_LIMITED",
  },
});

router.post("/auth/signup", signupLimiter, async (req, res) => {
  const input = validate(SignUpBody, req.body);
  const email = input.email.trim().toLowerCase();
  if (await User.exists({ email })) {
    throw new HttpError(409, "An account with this email already exists.", "CONFLICT");
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await User.create({
    name: input.name.trim(),
    email,
    passwordHash,
    role: "BORROWER",
    status: "ACTIVE",
    eligibilityStatus: "NOT_CHECKED",
    eligibilityErrors: [],
  });
  setSessionCookie(res, user._id.toString());
  res
    .status(201)
    .json(SignUpResponse.parse({ user: userDto(user) }));
});

router.post("/auth/login", authLimiter, async (req, res) => {
  const input = validate(LogInBody, req.body);
  const user = await User.findOne({ email: input.email.trim().toLowerCase() })
    .select("+passwordHash")
    .exec();
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new HttpError(401, "Email or password is incorrect.", "UNAUTHORIZED");
  }
  if (user.status === "DISABLED") {
    throw new HttpError(401, "This account has been disabled.", "UNAUTHORIZED");
  }

  setSessionCookie(res, user._id.toString());
  res.json(LogInResponse.parse({ user: userDto(user) }));
});

router.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json(LogOutResponse.parse({ message: "You have been signed out." }));
});

router.get("/auth/me", requireAuth, (req, res) => {
  const user = req.currentUser!;
  res.json(
    GetCurrentUserResponse.parse({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
    }),
  );
});

export default router;
