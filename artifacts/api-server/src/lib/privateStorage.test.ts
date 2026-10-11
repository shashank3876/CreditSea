import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createSalarySlipObjectKey, __privateStorageTest } from "./privateStorage";

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

test("salary-slip object keys are durable private paths, not signed URLs", () => {
  const key = createSalarySlipObjectKey();
  assert.match(key, __privateStorageTest.OBJECT_KEY_PATTERN);
  assert.equal(__privateStorageTest.storageObjectName(key).startsWith("uploads/"), true);
  assert.doesNotMatch(key, /^https?:\/\//);
});

test("resolveDriver prefers AWS S3 when AWS_S3_BUCKET is set", () => {
  process.env.AWS_S3_BUCKET = "creditsea-slips";
  process.env.AWS_REGION = "ap-south-1";
  delete process.env.PRIVATE_OBJECT_DIR;
  assert.equal(__privateStorageTest.resolveDriver(), "s3");
});

test("resolveDriver uses local filesystem for relative PRIVATE_OBJECT_DIR", () => {
  delete process.env.AWS_S3_BUCKET;
  process.env.PRIVATE_OBJECT_DIR = "./.private-objects";
  assert.equal(__privateStorageTest.resolveDriver(), "fs");
});

test("resolveDriver uses gcs for Replit-style PRIVATE_OBJECT_DIR", () => {
  delete process.env.AWS_S3_BUCKET;
  process.env.PRIVATE_OBJECT_DIR = "/replit-bucket/private";
  delete process.env.STORAGE_DRIVER;
  assert.equal(__privateStorageTest.resolveDriver(), "gcs");
});
