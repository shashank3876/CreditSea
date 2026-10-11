import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectMongo } from "../lib/mongo";
import { User, USER_ROLES, type UserRole } from "../lib/models";

const SEED_ACCOUNTS: Array<{ email: string; name: string; role: UserRole }> = [
  { email: "admin@creditsea.test", name: "CreditSea Admin", role: "ADMIN" },
  { email: "sales@creditsea.test", name: "Sales Reviewer", role: "SALES" },
  { email: "sanction@creditsea.test", name: "Sanction Reviewer", role: "SANCTION" },
  {
    email: "disbursement@creditsea.test",
    name: "Disbursement Reviewer",
    role: "DISBURSEMENT",
  },
  {
    email: "collection@creditsea.test",
    name: "Collections Reviewer",
    role: "COLLECTION",
  },
  { email: "borrower@creditsea.test", name: "Demo Borrower", role: "BORROWER" },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error(
      "Production demo seeding requires ALLOW_DEMO_SEED=true for this run.",
    );
  }

  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12 || password.length > 128) {
    throw new Error(
      "Set SEED_PASSWORD to a unique value between 12 and 128 characters using workspace secrets.",
    );
  }

  await connectMongo();
  const passwordHash = await bcrypt.hash(password, 12);
  for (const account of SEED_ACCOUNTS) {
    const existing = await User.findOne({ email: account.email }).exec();
    if (existing) {
      if (existing.role !== account.role) {
        throw new Error(
          `Seed account ${account.email} already exists with a different role; no changes were made to it.`,
        );
      }
      continue;
    }
    await User.create({
      ...account,
      passwordHash,
      status: "ACTIVE",
      eligibilityStatus: "NOT_CHECKED",
      eligibilityErrors: [],
    });
  }

  const seeded = await User.find({
    email: { $in: SEED_ACCOUNTS.map((account) => account.email) },
  })
    .select("email role")
    .sort({ email: 1 })
    .lean()
    .exec();
  if (
    seeded.length !== SEED_ACCOUNTS.length ||
    seeded.some(
      (account) =>
        !USER_ROLES.includes(account.role as UserRole) ||
        !SEED_ACCOUNTS.some(
          (seed) => seed.email === account.email && seed.role === account.role,
        ),
    )
  ) {
    throw new Error("Seed account verification failed.");
  }

  process.stdout.write(
    `Seeded or verified ${seeded.length} CreditSea evaluation accounts. Password is supplied only through SEED_PASSWORD.\\n`,
  );
}

main()
  .catch(() => {
    process.stderr.write("CreditSea evaluation account seeding failed. Check configuration and retry.\\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
