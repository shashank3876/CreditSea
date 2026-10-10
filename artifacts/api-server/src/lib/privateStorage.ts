import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Storage } from "@google-cloud/storage";
import type { Response } from "express";
import { HttpError } from "./errors";

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const PRIVATE_OBJECT_PREFIX = "/objects/";

const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

type ParsedObjectPath = { bucketName: string; objectName: string };

function parseObjectPath(value: string): ParsedObjectPath {
  const normalized = value.startsWith("/") ? value : `/${value}`;
  const [empty, bucketName, ...objectParts] = normalized.split("/");
  const objectName = objectParts.join("/");
  if (empty !== "" || !bucketName || !objectName) {
    throw new Error("Invalid private object path.");
  }
  return { bucketName, objectName };
}

function privateObjectPath(objectKey: string): string {
  if (!/^\/objects\/uploads\/[0-9a-f-]{36}$/.test(objectKey)) {
    throw new HttpError(404, "File not found.", "NOT_FOUND");
  }
  const privateDir = process.env.PRIVATE_OBJECT_DIR?.replace(/\/+$/, "");
  if (!privateDir) {
    throw new Error("Private object storage is not configured.");
  }
  return `${privateDir}/${objectKey.slice(PRIVATE_OBJECT_PREFIX.length)}`;
}

export function createSalarySlipObjectKey(): string {
  return `${PRIVATE_OBJECT_PREFIX}uploads/${randomUUID()}`;
}

export async function savePrivateObject(
  objectKey: string,
  contents: Buffer,
  contentType: string,
): Promise<void> {
  const target = parseObjectPath(privateObjectPath(objectKey));
  await storage
    .bucket(target.bucketName)
    .file(target.objectName)
    .save(contents, {
      resumable: false,
      validation: "crc32c",
      metadata: {
        contentType,
        cacheControl: "private, no-store",
      },
    });
}

export async function deletePrivateObject(objectKey: string): Promise<void> {
  const target = parseObjectPath(privateObjectPath(objectKey));
  await storage
    .bucket(target.bucketName)
    .file(target.objectName)
    .delete({ ignoreNotFound: true });
}

export async function streamPrivateObject(
  objectKey: string,
  contentType: string,
  fileName: string,
  res: Response,
): Promise<void> {
  const target = parseObjectPath(privateObjectPath(objectKey));
  const file = storage.bucket(target.bucketName).file(target.objectName);
  const [exists] = await file.exists();
  if (!exists) throw new HttpError(404, "File not found.", "NOT_FOUND");

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  await pipeline(file.createReadStream(), res);
}
