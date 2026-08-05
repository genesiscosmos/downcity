/** 将 `fed web` 静态前端资源复制到 CLI 发布目录。 */
import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const package_root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(resolve(package_root, "bin/federation/web-ui"), { recursive: true });
await cp(
  resolve(package_root, "src/federation/web-ui"),
  resolve(package_root, "bin/federation/web-ui"),
  { recursive: true },
);
