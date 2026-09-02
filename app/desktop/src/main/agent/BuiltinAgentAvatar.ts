/**
 * Desktop 内置 Agent 头像池。
 *
 * 头像资源由 Desktop 宿主拥有，并随应用一起发布。该模块只负责定位资源、校验候选
 * 文件与随机选择，不介入 Agent 头像的持久化协议。
 */

import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";

const BUILTIN_AVATAR_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/** 读取开发或打包环境中的内置头像文件，并按文件名稳定排序。 */
export function list_builtin_agent_avatar_paths(): string[] {
  const module_directory = path.dirname(fileURLToPath(import.meta.url));
  const packaged_candidates = process.resourcesPath
    ? [path.join(process.resourcesPath, "agent-avatars")]
    : [];
  const candidates = [
    ...packaged_candidates,
    path.resolve(module_directory, "../../resources/agent-avatars"),
    path.resolve(module_directory, "../../../resources/agent-avatars"),
    path.resolve(process.cwd(), "app/desktop/resources/agent-avatars"),
  ];
  const resource_directory = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resource_directory) throw new Error("Desktop built-in Agent avatar assets are unavailable");
  const avatar_paths = fs.readdirSync(resource_directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && BUILTIN_AVATAR_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(resource_directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
  if (avatar_paths.length === 0) throw new Error("Desktop built-in Agent avatar pool is empty");
  return avatar_paths;
}

/**
 * 随机选择一张内置头像。
 *
 * 当前头像来自同一资源池时会被排除；头像池只有一张时允许返回原头像。
 */
export function select_builtin_agent_avatar_path(current_avatar_url?: string): string {
  const avatar_paths = list_builtin_agent_avatar_paths();
  const selectable_paths = avatar_paths.length > 1 && current_avatar_url
    ? avatar_paths.filter((avatar_path) => to_avatar_data_url(avatar_path) !== current_avatar_url)
    : avatar_paths;
  const candidates = selectable_paths.length > 0 ? selectable_paths : avatar_paths;
  return candidates[randomInt(candidates.length)];
}

/** 将候选资源转换为与 AgentRepository 读取结果一致的数据地址。 */
function to_avatar_data_url(avatar_path: string): string {
  const extension = path.extname(avatar_path).toLowerCase();
  const media_type = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${media_type};base64,${fs.readFileSync(avatar_path).toString("base64")}`;
}
