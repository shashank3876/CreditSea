import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Storage } from "@google-cloud/storage";
import type { Response } from "express";
import { HttpError } from "./errors";

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const PRIVATE_OBJECT_PREFIX = "/objects/";
const OBJECT_KEY_PATTERN = /^\/objects\/uploads\/[0-9a-f-]{36}$/;

type StorageDriver = "s3" | "gcs" | "fs";

type ParsedObjectPath = { bucketName: string; objectName: string };

let s3Client: S3Client | null = null;
let gcsStorage: Storage | null = null;

function assertObjectKey(objectKey: string): void {
  if (!OBJECT_KEY_PATTERN.test(objectKey)) {
    throw new HttpError(404, "File not found.", "NOT_FOUND");
  }
}

/**
 * Durable private storage key stored in MongoDB.
 * Uses a random UUID so the original client filename is never used as the
 * object name. Never store temporary signed URLs.
 */
export function createSalarySlipObjectKey(): string {
  return `${PRIVATE_OBJECT_PREFIX}uploads/${randomUUID()}`;
}

function storageObjectName(objectKey: string): string {
  assertObjectKey(objectKey);
  return objectKey.slice(PRIVATE_OBJECT_PREFIX.length);
}

function resolveDriver(): StorageDriver {
  if (process.env.AWS_S3_BUCKET?.trim()) return "s3";
  const privateDir = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!privateDir) {
    throw new Error(
      "Object storage is not configured. Set AWS_S3_BUCKET (AWS) or PRIVATE_OBJECT_DIR (Replit/local).",
    );
  }
  const explicit = process.env.STORAGE_DRIVER?.trim().toLowerCase();
  if (explicit === "s3") {
    throw new Error("STORAGE_DRIVER=s3 requires AWS_S3_BUCKET.");
  }
  if (explicit === "fs" || explicit === "local") return "fs";
  if (explicit === "gcs" || explicit === "replit") return "gcs";
  if (
    privateDir.startsWith("./") ||
    privateDir.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(privateDir) ||
    privateDir.startsWith("/Users/") ||
    privateDir.startsWith("/home/") ||
    privateDir.startsWith("/tmp/") ||
    privateDir.startsWith("/var/")
  ) {
    return "fs";
  }
  return "gcs";
}

function getS3(): { client: S3Client; bucket: string } {
  const bucket = process.env.AWS_S3_BUCKET?.trim();
  if (!bucket) throw new Error("AWS_S3_BUCKET is required for S3 storage.");
  if (!s3Client) {
    const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();
    if (!region) {
      throw new Error("AWS_REGION is required when using S3 storage.");
    }
    s3Client = new S3Client({ region });
  }
  return { client: s3Client, bucket };
}

function getGcs(): Storage {
  if (!gcsStorage) {
    gcsStorage = new Storage({
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
  }
  return gcsStorage;
}

function parseObjectPath(value: string): ParsedObjectPath {
  const normalized = value.startsWith("/") ? value : `/${value}`;
  const [empty, bucketName, ...objectParts] = normalized.split("/");
  const objectName = objectParts.join("/");
  if (empty !== "" || !bucketName || !objectName) {
    throw new Error("Invalid private object path.");
  }
  return { bucketName, objectName };
}

function gcsObjectPath(objectKey: string): ParsedObjectPath {
  const privateDir = process.env.PRIVATE_OBJECT_DIR?.replace(/\/+$/, "");
  if (!privateDir) {
    throw new Error("PRIVATE_OBJECT_DIR is required for Replit object storage.");
  }
  return parseObjectPath(`${privateDir}/${storageObjectName(objectKey)}`);
}

function localFilePath(objectKey: string): string {
  const privateDir = process.env.PRIVATE_OBJECT_DIR?.replace(/\/+$/, "");
  if (!privateDir) {
    throw new Error("PRIVATE_OBJECT_DIR is required for local object storage.");
  }
  const root = resolve(privateDir);
  const fullPath = resolve(join(root, storageObjectName(objectKey)));
  if (!fullPath.startsWith(`${root}/`) && fullPath !== root) {
    throw new HttpError(404, "File not found.", "NOT_FOUND");
  }
  return fullPath;
}

function attachmentHeaders(
  contentType: string,
  fileName: string,
  res: Response,
): void {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

export async function savePrivateObject(
  objectKey: string,
  contents: Buffer,
  contentType: string,
): Promise<void> {
  const driver = resolveDriver();
  if (driver === "s3") {
    const { client, bucket } = getS3();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageObjectName(objectKey),
        Body: contents,
        ContentType: contentType,
        CacheControl: "private, no-store",
        ServerSideEncryption: "AES256",
      }),
    );
    return;
  }

  if (driver === "fs") {
    const path = localFilePath(objectKey);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(Readable.from(contents), createWriteStream(path));
    return;
  }

  const target = gcsObjectPath(objectKey);
  await getGcs()
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
  const driver = resolveDriver();
  if (driver === "s3") {
    const { client, bucket } = getS3();
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: storageObjectName(objectKey),
      }),
    );
    return;
  }

  if (driver === "fs") {
    await unlink(localFilePath(objectKey)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    return;
  }

  const target = gcsObjectPath(objectKey);
  await getGcs()
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
  const driver = resolveDriver();
  attachmentHeaders(contentType, fileName, res);

  if (driver === "s3") {
    const { client, bucket } = getS3();
    const result = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: storageObjectName(objectKey),
      }),
    );
    if (!result.Body) throw new HttpError(404, "File not found.", "NOT_FOUND");
    await pipeline(result.Body as Readable, res);
    return;
  }

  if (driver === "fs") {
    try {
      await pipeline(createReadStream(localFilePath(objectKey)), res);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new HttpError(404, "File not found.", "NOT_FOUND");
      }
      throw error;
    }
    return;
  }

  const target = gcsObjectPath(objectKey);
  const file = getGcs().bucket(target.bucketName).file(target.objectName);
  const [exists] = await file.exists();
  if (!exists) throw new HttpError(404, "File not found.", "NOT_FOUND");
  await pipeline(file.createReadStream(), res);
}

/**
 * Short-lived download URL for private salary slips.
 * Prefer authenticated API streaming for app downloads; use this only when a
 * temporary direct link is required. Do not persist the URL in MongoDB.
 */
export async function createPresignedDownloadUrl(
  objectKey: string,
  fileName: string,
  expiresInSeconds = 300,
): Promise<string> {
  if (resolveDriver() !== "s3") {
    throw new Error("Presigned download URLs are only available with AWS S3 storage.");
  }
  const { client, bucket } = getS3();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: storageObjectName(objectKey),
      ResponseContentDisposition: `attachment; filename="${safeName}"`,
    }),
    { expiresIn: expiresInSeconds },
  );
}

/** Exported for unit tests. */
export const __privateStorageTest = {
  assertObjectKey,
  storageObjectName,
  resolveDriver,
  OBJECT_KEY_PATTERN,
};
