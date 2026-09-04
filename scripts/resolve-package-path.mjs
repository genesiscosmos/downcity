/**
 * @file 根据 package manifest 输出稳定构建 key 对应的真实 workspace 路径。
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolve_package_path } from "./package-graph.mjs";

const workspace_root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [target_key] = process.argv.slice(2);
if (!target_key) throw new Error("必须提供 package key");

console.log(resolve_package_path(workspace_root, target_key));
