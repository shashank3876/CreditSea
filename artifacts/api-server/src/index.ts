import app from "./app";
import { logger } from "./lib/logger";
import { connectMongo } from "./lib/mongo";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start(): Promise<void> {
  await connectMongo();
  const server = app.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    logger.error({ code: error.code }, "Error listening on port");
    process.exit(1);
  });
}

start().catch((error: unknown) => {
  const details =
    error && typeof error === "object"
      ? (error as {
          name?: unknown;
          code?: unknown;
          reason?: { type?: unknown };
          cause?: {
            name?: unknown;
            code?: unknown;
            codeName?: unknown;
            syscall?: unknown;
          };
        })
      : {};
  const safeText = (value: unknown) =>
    typeof value === "string" || typeof value === "number"
      ? String(value).slice(0, 80)
      : undefined;
  logger.fatal(
    {
      errorName: safeText(details.name) ?? "UnknownError",
      errorCode: safeText(details.code),
      topologyReason: safeText(details.reason?.type),
      causeName: safeText(details.cause?.name),
      causeCode: safeText(details.cause?.code),
      causeCodeName: safeText(details.cause?.codeName),
      causeSyscall: safeText(details.cause?.syscall),
    },
    "API startup failed",
  );
  process.exit(1);
});
