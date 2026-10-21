/**
 * 将 Fedman 编译产物复制到 CLI 发布目录。
 *
 * 关键点（中文）
 * - Fedman 是 Federation 控制台前端，源码不在 Public 仓库：它属于 `private/apps/fedman`。
 *   Public 构建不负责编译它，只负责把已构建的 dist 放进 CLI 发布产物。
 * - `bin/federation/fedman/` 是 `fed web` 读取的静态资源根，其内容不进入版本库。
 * - 解析顺序固定：`DOWNCITY_FEDMAN_DIST` 优先（发布与 CI 显式指定），
 *   否则回退到本地 monorepo 的 `private/apps/fedman/dist`（开发者直接构建 CLI 时可用）。
 * - 只复制构建产物，不修改源目录，也不在网络或全局缓存中查找。
 */
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const package_root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target_dir = resolve(package_root, "bin/federation/fedman");

/** 候选 dist 目录，按优先级排列；第一项为显式环境变量。 */
const candidates = [
  ...(process.env.DOWNCITY_FEDMAN_DIST?.trim() ? [resolve(process.env.DOWNCITY_FEDMAN_DIST.trim())] : []),
  // 本地 monorepo：<root>/public/packages/cli -> <root>/private/apps/fedman/dist
  resolve(package_root, "../../../private/apps/fedman/dist"),
];

/** 依次探测候选目录，返回第一个含 index.html 的目录。 */
async function resolve_fedman_dist() {
  for (const candidate of candidates) {
    const index = await stat(resolve(candidate, "index.html")).catch(() => null);
    if (index?.isFile()) return candidate;
  }
  return null;
}

const fedman_dist = await resolve_fedman_dist();
if (!fedman_dist) {
  throw new Error(
    [
      "Fedman build output is missing.",
      "Build it first (`pnpm -C private/apps/fedman build` at the workspace root),",
      "or set DOWNCITY_FEDMAN_DIST to an existing dist directory.",
      "Searched:",
      ...candidates.map((candidate) => `  - ${candidate}`),
    ].join("\n"),
  );
}

await rm(target_dir, { recursive: true, force: true });
await mkdir(target_dir, { recursive: true });
await cp(fedman_dist, target_dir, { recursive: true });
