/**
 * 本机宿主的扩展秘密版本存储。仅当前操作系统用户可读写，版本文件只创建不覆盖；
 * SQLite 与普通操作结果只保存版本号，不保存秘密值。普通移除保留版本供原身份重加。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ExtensionFailure } from "./ExtensionError.js";

/** 版本的路径只由宿主 UUID 生成，作者字段名不进入文件路径。 */
export class ExtensionSecrets {
  constructor(private readonly root_path: string) {}

  private filename(extension_id: string, version: string): string {
    if (!/^[a-f\d-]{36}$/u.test(extension_id) || !/^(initial|[a-f\d-]{36})$/u.test(version)) throw new ExtensionFailure("configuration_invalid", "Secret version identity is invalid", "load", 2);
    return path.join(this.root_path, "private", "extensions", extension_id, `${version}.json`);
  }

  /** 缺省初始版本为空；其他丢失版本不能假装没有秘密。 */
  async read(extension_id: string, version: string): Promise<Record<string, string>> {
    if (version === "initial") return {};
    try {
      const filename = this.filename(extension_id, version);
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== "win32" && (stat.mode & 0o077))) throw new Error();
      return JSON.parse(await fs.readFile(filename, "utf8"));
    } catch { throw new ExtensionFailure("secret_version_unavailable", "The applied secret version is unavailable", "load", 5); }
  }

  /** 写新版本后才允许仓储引用，失败最多留下不可执行的孤立版本。 */
  async write(extension_id: string, version: string, values: Record<string, string>): Promise<void> {
    const filename = this.filename(extension_id, version);
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    await fs.chmod(path.dirname(filename), 0o700);
    await fs.writeFile(filename, JSON.stringify(values), { mode: 0o600, flag: "wx" });
  }
}
