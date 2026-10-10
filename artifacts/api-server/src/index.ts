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
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name: unknown }).name)
      : "UnknownError";
  logger.fatal({ errorName: name }, "API startup failed");
  process.exit(1);
});
