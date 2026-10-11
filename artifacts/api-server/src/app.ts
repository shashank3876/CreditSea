import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { enforceSameOriginForCookieWrites } from "./lib/security";
import { errorHandler } from "./middlewares/errorHandler";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const allowedOrigins = new Set(
  (process.env.WEB_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
app.use(
  cors({
    origin(origin, callback) {
      callback(
        null,
        origin && allowedOrigins.has(origin) ? origin : false,
      );
    },
    credentials: true,
    maxAge: 600,
  }),
);
app.use(express.json({ limit: "256kb", strict: true }));
app.use(cookieParser());
app.use(enforceSameOriginForCookieWrites);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

app.use("/api", router);
app.use(errorHandler);

export default app;
