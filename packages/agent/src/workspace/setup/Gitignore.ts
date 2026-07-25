/**
 * Workspace 初始化 `.gitignore` 维护模块。
 *
 * 职责说明（中文）
 * - 负责在 agent 项目初始化阶段把必要的忽略规则补进 `.gitignore`。
 * - 让项目配置与运行时状态目录的忽略策略留在 `config/` 语义域内统一维护。
 *
 * 边界说明（中文）
 * - 这里只做最小化补丁写入，不负责 `.gitignore` 的复杂排序、分组或格式整理。
 * - 当前主要服务项目初始化流程，不追求抽象成通用 Git 文本编辑器。
 */

import fs from "fs-extra";
import path from "node:path";

/**
 * 确保 `.gitignore` 中存在指定规则。
 *
 * 关键点（中文）
 * - 只会在末尾追加缺失规则，不会重排用户已有内容。
 * - 返回值用于告诉调用方本次是新建、更新还是无需修改。
 * - 设计目标是“尽量少打扰用户已有文件结构”。
 */
export async function ensureGitignoreEntry(
  projectRoot: string,
  entry: string,
): Promise<"created" | "updated" | "unchanged"> {
  const normalizedProjectRoot = path.resolve(String(projectRoot || "").trim() || ".");
  const normalizedEntry = String(entry || "").trim();
  if (!normalizedEntry) return "unchanged";

  const gitignorePath = path.join(normalizedProjectRoot, ".gitignore");
  const hasGitignore = await fs.pathExists(gitignorePath);
  const existingContent = hasGitignore
    ? await fs.readFile(gitignorePath, "utf-8")
    : "";
  const normalizedLines = existingContent
    .split(/\r?\n/)
    .map((line) => String(line || "").trim());

  if (normalizedLines.includes(normalizedEntry)) {
    return "unchanged";
  }

  const chunks = existingContent ? [existingContent] : [];
  if (existingContent && !existingContent.endsWith("\n")) {
    chunks.push("\n");
  }
  chunks.push(`${normalizedEntry}\n`);
  await fs.writeFile(gitignorePath, chunks.join(""), "utf-8");
  return hasGitignore ? "updated" : "created";
}
