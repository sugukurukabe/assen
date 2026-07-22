/**
 * オブジェクトストレージクライアント（S3互換）。ローカルはMinIO、本番はGCS（S3互換API有効時）を想定する
 * Object storage client (S3-compatible). Local uses MinIO; production targets GCS (with S3-compatible API enabled)
 * Klien object storage (kompatibel S3). Lokal memakai MinIO; produksi menargetkan GCS (dengan API kompatibel S3 aktif)
 */
import { PutObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loadEnv } from "./env.js";
import { sha256Hex } from "./hash.js";

let client: S3Client | undefined;

function getClient(): S3Client {
  if (!client) {
    const env = loadEnv();
    client = new S3Client({
      endpoint: env.STORAGE_ENDPOINT,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY,
        secretAccessKey: env.STORAGE_SECRET_KEY,
      },
    });
  }
  return client;
}

export interface PutImmutableObjectResult {
  objectUri: string;
  sha256: string;
}

/**
 * バイト列をcontent-addressable（SHA-256ベースのキー）で保存する。同一内容は同一キーになり冪等
 * Stores bytes content-addressably (SHA-256-based key). Identical content maps to the same key, making writes idempotent
 * Menyimpan byte secara content-addressable (kunci berbasis SHA-256). Konten identik memetakan ke kunci yang sama, membuat penulisan idempotent
 */
export async function putImmutableObject(prefix: string, bytes: Buffer, contentType: string): Promise<PutImmutableObjectResult> {
  const env = loadEnv();
  const digest = sha256Hex(bytes);
  const key = `${prefix}/${digest}`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );

  return { objectUri: `${env.STORAGE_BUCKET}/${key}`, sha256: digest };
}

export async function getObjectBytes(objectUri: string): Promise<Buffer> {
  const env = loadEnv();
  const key = objectUri.startsWith(`${env.STORAGE_BUCKET}/`) ? objectUri.slice(env.STORAGE_BUCKET.length + 1) : objectUri;
  const response = await getClient().send(new GetObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: key }));
  const body = await response.Body?.transformToByteArray();
  if (!body) {
    throw new Error(`オブジェクトが見つかりません / object not found: ${objectUri}`);
  }
  return Buffer.from(body);
}

/**
 * 起動時にバケットが存在することを確認する（ローカル開発の取りこぼし防止。存在しなくても例外にしない）
 * Ensures the bucket exists at startup (guards against local-dev oversight; does not throw if creation fails)
 * Memastikan bucket ada saat startup (mencegah kelalaian dev lokal; tidak melempar error jika pembuatan gagal)
 */
export async function ensureBucketExists(): Promise<void> {
  const env = loadEnv();
  const { CreateBucketCommand, HeadBucketCommand } = await import("@aws-sdk/client-s3");
  try {
    await getClient().send(new HeadBucketCommand({ Bucket: env.STORAGE_BUCKET }));
  } catch {
    await getClient().send(new CreateBucketCommand({ Bucket: env.STORAGE_BUCKET })).catch(() => undefined);
  }
}
