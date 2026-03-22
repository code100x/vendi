import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { env } from "../config/env";

const ALGORITHM = "aes-256-gcm";
const KEY = Buffer.from(env.ENCRYPTION_KEY, "hex");

export function encrypt(text: string): { encrypted: string; iv: string } {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();
  return {
    encrypted: encrypted + ":" + authTag.toString("base64"),
    iv: iv.toString("base64"),
  };
}

export function decrypt(encrypted: string, iv: string): string {
  const [encData, authTagStr] = encrypted.split(":");
  const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTagStr, "base64"));
  let decrypted = decipher.update(encData, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
