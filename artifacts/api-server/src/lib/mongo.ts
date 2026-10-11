import mongoose from "mongoose";
import { logger } from "./logger";

let connectPromise: Promise<typeof mongoose> | undefined;

export async function connectMongo(): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required to start the API.");
  }

  if (mongoose.connection.readyState === 1) return mongoose;
  if (!connectPromise) {
    connectPromise = mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15_000,
      autoIndex: true,
    });
  }

  try {
    const connection = await connectPromise;
    logger.info("MongoDB connection established");
    return connection;
  } catch (error) {
    connectPromise = undefined;
    throw error;
  }
}
