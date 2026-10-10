import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: error.message,
      code: error.code,
      ...(error.details ? { fieldErrors: error.details } : {}),
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    res.status(tooLarge ? 413 : 400).json({
      error: tooLarge
        ? "The file is larger than the 5 MB limit."
        : "The uploaded file could not be accepted.",
      code: tooLarge ? "FILE_TOO_LARGE" : "INVALID_FILE",
    });
    return;
  }

  const safeError = error as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
  };
  if (safeError.code === 11000) {
    res.status(409).json({
      error: "A record with this value already exists.",
      code: "CONFLICT",
    });
    return;
  }
  if (safeError.name === "CastError") {
    res.status(400).json({
      error: "The requested record identifier is invalid.",
      code: "INVALID_ID",
    });
    return;
  }

  logger.error(
    {
      errorName:
        typeof safeError.name === "string" ? safeError.name : "UnknownError",
      errorCode: typeof safeError.code === "number" ? safeError.code : undefined,
    },
    "Unhandled API request error",
  );
  res.status(500).json({
    error: "Something went wrong. Please try again.",
    code: "INTERNAL_ERROR",
  });
};
