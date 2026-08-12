/** LocalCityStore AES-256-GCM 配置加密工具。 */

import crypto from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import { get_local_key_path } from "@/store/LocalPaths.js";

/** 单个 LocalCityStore 使用的加密器。 */
export class LocalCrypto {
  /** 缓存的 32 字节密钥。 */
  private key?: Buffer;

  constructor(private readonly root_path: string) {}

  /** 加密 UTF-8 字符串。 */
  encrypt(plain_text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.get_key(), iv);
    const body = Buffer.concat([cipher.update(plain_text, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  }

  /** 解密 UTF-8 字符串。 */
  decrypt(cipher_text: string): string {
    const packed = Buffer.from(cipher_text, "base64");
    if (packed.length < 28) throw new Error("Invalid encrypted payload");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.get_key(),
      packed.subarray(0, 12),
    );
    decipher.setAuthTag(packed.subarray(12, 28));
    return Buffer.concat([
      decipher.update(packed.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  }

  /** 读取或创建当前 Store 的唯一密钥。 */
  private get_key(): Buffer {
    if (this.key) return this.key;
    const env_key = String(process.env.DC_MODEL_DB_KEY || "").trim();
    if (env_key) {
      this.key = crypto.createHash("sha256").update(env_key, "utf8").digest();
      return this.key;
    }
    const key_path = get_local_key_path(this.root_path);
    fs.ensureDirSync(path.dirname(key_path));
    if (fs.existsSync(key_path)) {
      const stored = Buffer.from(String(fs.readFileSync(key_path, "utf8")).trim(), "base64");
      if (stored.length === 32) {
        this.key = stored;
        return stored;
      }
    }
    this.key = crypto.randomBytes(32);
    fs.writeFileSync(key_path, this.key.toString("base64"), { mode: 0o600 });
    return this.key;
  }
}
