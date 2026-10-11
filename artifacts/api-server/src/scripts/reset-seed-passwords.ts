import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectMongo } from "../lib/mongo";
import { User } from "../lib/models";

const SEED_EMAILS = [
  "admin@creditsea.test",
  "sales@creditsea.test",
  "sanction@creditsea.test",
  "disbursement@creditsea.test",
  "collection@creditsea.test",
  "borrower@creditsea.test",
] as const;

async function main(): Promise<void> {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12 || password.length > 128) {
    throw new Error(
      "Set SEED_PASSWORD to a unique value between 12 and 128 characters.",
    );
  }

  await connectMongo();
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await User.updateMany(
    { email: { $in: [...SEED_EMAILS] } },
    { $set: { passwordHash, status: "ACTIVE" } },
  );
  process.stdout.write(
    `Updated ${result.modifiedCount} evaluation account password(s) to the current SEED_PASSWORD.\n`,
  );
}

main()
  .catch(() => {
    process.stderr.write("Failed to reset evaluation account passwords.\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
