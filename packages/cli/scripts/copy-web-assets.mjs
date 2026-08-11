/** 将 Fedman 编译产物复制到 CLI 发布目录。 */
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const package_root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fedman_dist = resolve(package_root, "../fedman/dist");
const target_dir = resolve(package_root, "bin/federation/fedman");
const cityman_dist = resolve(package_root, "../cityman/dist");
const cityman_target_dir = resolve(package_root, "bin/city/cityman");
const fedman_index = await stat(resolve(fedman_dist, "index.html")).catch(() => null);
if (!fedman_index?.isFile()) {
  throw new Error("Fedman build output is missing. Run packages/fedman build first.");
}
await rm(target_dir, { recursive: true, force: true });
await mkdir(target_dir, { recursive: true });
await cp(
  fedman_dist,
  target_dir,
  { recursive: true },
);
const cityman_index = await stat(resolve(cityman_dist, "index.html")).catch(() => null);
if (!cityman_index?.isFile()) throw new Error("Cityman build output is missing. Run packages/cityman build first.");
await rm(cityman_target_dir, { recursive: true, force: true });
await mkdir(cityman_target_dir, { recursive: true });
await cp(cityman_dist, cityman_target_dir, { recursive: true });
