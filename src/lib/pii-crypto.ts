/**
 * PII列（氏名・住所・生年月日）のアプリ層暗号化。ローカル開発はenv鍵、本番はKMSに置き換える
 * Application-layer encryption for PII columns (name/address/birth date). Local dev uses an env key; production should use KMS
 * Enkripsi lapisan aplikasi untuk kolom PII (nama/alamat/tanggal lahir). Dev lokal memakai kunci env; produksi harus memakai KMS
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { loadEnv } from "./env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function resolveKey(): Buffer {
  const env = loadEnv();
  if (!env.PII_ENCRYPTION_KEY) {
    throw new Error(
      "PII_ENCRYPTION_KEY が未設定です。openssl rand -base64 32 で生成してください / PII_ENCRYPTION_KEY is not set. Generate one with openssl rand -base64 32",
    );
  }
  const key = Buffer.from(env.PII_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("PII_ENCRYPTION_KEY は32byte(base64)である必要があります / PII_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return key;
}

/**
 * 平文をAES-256-GCMで暗号化し、iv:authTag:ciphertextをbase64連結した文字列として返す
 * Encrypts plaintext with AES-256-GCM and returns iv:authTag:ciphertext base64-joined
 * Mengenkripsi teks polos dengan AES-256-GCM dan mengembalikan iv:authTag:ciphertext yang digabung base64
 */
export function encryptPii(plaintext: string): string {
  const key = resolveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/**
 * encryptPiiで生成した文字列を復号する
 * Decrypts a string produced by encryptPii
 * Mendekripsi string yang dihasilkan oleh encryptPii
 */
export function decryptPii(encoded: string): string {
  const key = resolveKey();
  const [ivB64, authTagB64, ciphertextB64] = encoded.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("暗号化データの形式が不正です / Malformed encrypted PII payload");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}
