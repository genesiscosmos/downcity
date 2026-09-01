/**
 * @file 输出 patch build 与 CLI 同步使用的 manifest 驱动 package 顺序。
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolve_package_build_order } from "./package-graph.mjs";

const workspace_root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target_keys = process.argv.slice(2);
if (target_keys.length === 0) {
  throw new Error("至少需要一个 package key");
}

for (const package_key of resolve_package_build_order(workspace_root, target_keys)) {
  console.log(package_key);
}
