/**
 * Workspace 初始化 Env 文件工具模块。
 *
 * 职责说明（中文）
 * - 负责项目 `.env` 文件的轻量解析与补齐。
 * - 服务于 agent 项目初始化与配置维护流程，避免把文本拼接逻辑散落到业务模块。
 *
 * 边界说明（中文）
 * - 这里只处理配置文件文本结构，不负责把值注入运行时 `process.env`。
 * - 当前能力以 agent 项目配置场景为中心，不追求成为通用 shell env 解析库。
 */

import fs from "fs-extra";
import type { EnvFileEntry } from "@/types/common/EnvFile.js";
import { escapeRegExp } from "@/utils/string/EscapeRegExp.js";

/**
 * 解析 Env 文本中已经声明的变量键名集合。
 *
 * 关键点（中文）
 * - 会忽略空行与注释行。
 * - 仅识别 `KEY=value` 的基础形式，足够覆盖当前 agent 配置初始化流程。
 */
export function parseEnvKeys(content: string): Set<string> {
  const out = new Set<string>();
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = String(rawLine || "").trim();
    if (!line || line.startsWith("#")) continue;
    const matched = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!matched) continue;
    out.add(matched[1]);
  }
  return out;
}

/**
 * 仅在目标文件缺失指定键时追加 Env 条目。
 *
 * 关键点（中文）
 * - 已存在的键默认保持不变，只有显式列入 `overwriteKeys` 才会覆写。
 * - 当目标文件原本为空时，会自动补一行总标题注释，便于用户识别来源。
 * - `entries` 中的空键名会被自动忽略，避免写入无效行。
 * - 该函数默认服务项目初始化阶段，因此输出格式偏向“可读、可手改”。
 */
export async function appendMissingEnvEntries(
  filePath: string,
  sectionTitle: string,
  entries: EnvFileEntry[],
  overwriteKeys?: Set<string>,
): Promise<void> {
  const normalizedFilePath = String(filePath || "").trim();
  if (!normalizedFilePath) return;

  const normalizedEntries = Array.isArray(entries)
    ? entries.filter((item) => Boolean(String(item?.key || "").trim()))
    : [];
  const writableOverwriteKeys = overwriteKeys || new Set<string>();

  let existing = "";
  if (await fs.pathExists(normalizedFilePath)) {
    existing = await fs.readFile(normalizedFilePath, "utf-8");
  }

  const existingKeys = parseEnvKeys(existing);
  let nextContent = existing;
  const appendedEntries: EnvFileEntry[] = [];

  for (const entry of normalizedEntries) {
    if (!existingKeys.has(entry.key)) {
      appendedEntries.push(entry);
      continue;
    }
    if (!writableOverwriteKeys.has(entry.key)) continue;
    const linePattern = new RegExp(`^${escapeRegExp(entry.key)}\\s*=.*$`, "gm");
    if (linePattern.test(nextContent)) {
      nextContent = nextContent.replace(linePattern, `${entry.key}=${entry.value}`);
    }
  }

  if (appendedEntries.length > 0) {
    const lines: string[] = [];
    if (!nextContent.trim()) {
      lines.push("# Downcity 环境变量");
    }
    lines.push("", `# ${String(sectionTitle || "").trim()}`);
    for (const entry of appendedEntries) {
      lines.push(`${entry.key}=${entry.value}`);
    }
    let chunk = lines.join("\n");
    if (nextContent && !nextContent.endsWith("\n")) {
      chunk = `\n${chunk}`;
    }
    nextContent = `${nextContent}${chunk}\n`;
  }

  if (appendedEntries.length > 0 || !(await fs.pathExists(normalizedFilePath))) {
    await fs.writeFile(normalizedFilePath, nextContent, "utf-8");
  }
}
