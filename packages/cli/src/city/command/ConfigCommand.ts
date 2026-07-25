/**
 * `city config` 命令组。
 *
 * 目标（中文）
 * - 提供 CLI 全局 DB 中 agent 配置的通用读写能力（get/set/unset）。
 * - 提供 alias 写入能力。
 * - 所有输出统一支持 JSON（默认）与可读文本两种模式。
 */

import path from "node:path";
import type { Command } from "commander";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import { aliasCommand } from "@/city/shared/Alias.js";
import { parseBoolean } from "@/shared/IndexSupport.js";
import { helpText, t } from "@/shared/CliLocale.js";
import {
  readAgentConfig,
  upsertAgentConfig,
  type StoredAgentConfig,
} from "@/city/process/registry/AgentConfigStore.js";

/**
 * 解析项目根目录。
 *
 * 关键点（中文）
 * - `city config` 是本机 City 配置命令，只需要纯路径解析能力。
 * - 不依赖 City plugin 目标解析模块，避免配置命令耦合运行态目标解析。
 */
function resolveProjectRoot(pathInput?: string): string {
  return path.resolve(String(pathInput || "."));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfigPath(pathInput: string): string[] {
  const trimmed = String(pathInput || "").trim();
  if (!trimmed) {
    throw new Error("Config path cannot be empty");
  }
  const parts = trimmed.split(".");
  if (parts.some((x) => x.trim().length === 0)) {
    throw new Error(`Invalid config path: ${pathInput}`);
  }
  return parts.map((x) => x.trim());
}

function parseConfigValue(rawValue: string): unknown {
  const trimmed = String(rawValue).trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return rawValue;
  }
}

function readStoredConfig(project_root: string): StoredAgentConfig {
  const config = readAgentConfig(project_root);
  if (!config) {
    throw new Error(`Agent config not found in global DB. Run "city agent create" first.`);
  }
  return config;
}

function writeStoredConfig(project_root: string, config: StoredAgentConfig): void {
  upsertAgentConfig({
    ...config,
    project_root,
  });
}

function getByPath(
  root: Record<string, unknown>,
  pathTokens: string[],
): { found: boolean; value?: unknown } {
  let cursor: unknown = root;
  for (const token of pathTokens) {
    if (!isPlainObject(cursor) || !(token in cursor)) {
      return { found: false };
    }
    cursor = cursor[token];
  }
  return { found: true, value: cursor };
}

function setByPath(
  root: Record<string, unknown>,
  pathTokens: string[],
  nextValue: unknown,
): { existed: boolean; previous: unknown } {
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < pathTokens.length - 1; i += 1) {
    const key = pathTokens[i];
    const current = cursor[key];
    if (current === undefined) {
      cursor[key] = {};
      cursor = cursor[key] as Record<string, unknown>;
      continue;
    }
    if (!isPlainObject(current)) {
      throw new Error(
        `Cannot set path "${pathTokens.join(".")}": "${pathTokens
          .slice(0, i + 1)
          .join(".")}" is not an object`,
      );
    }
    cursor = current;
  }
  const leaf = pathTokens[pathTokens.length - 1];
  const existed = Object.prototype.hasOwnProperty.call(cursor, leaf);
  const previous = cursor[leaf];
  cursor[leaf] = nextValue;
  return { existed, previous };
}

function unsetByPath(
  root: Record<string, unknown>,
  pathTokens: string[],
): { removed: boolean; previous: unknown } {
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < pathTokens.length - 1; i += 1) {
    const key = pathTokens[i];
    const current = cursor[key];
    if (!isPlainObject(current)) {
      return { removed: false, previous: undefined };
    }
    cursor = current;
  }
  const leaf = pathTokens[pathTokens.length - 1];
  if (!Object.prototype.hasOwnProperty.call(cursor, leaf)) {
    return { removed: false, previous: undefined };
  }
  const previous = cursor[leaf];
  delete cursor[leaf];
  return { removed: true, previous };
}

function runConfigCommand(
  options: { path?: string; json?: boolean },
  handler: (input: {
    project_root: string;
    config: StoredAgentConfig;
  }) => {
    title: string;
    payload: Record<string, unknown>;
    save?: boolean;
  },
): void {
  const asJson = options.json !== false;
  try {
    const project_root = resolveProjectRoot(options.path);
    const config = readStoredConfig(project_root);
    const result = handler({ project_root, config });
    if (result.save) {
      writeStoredConfig(project_root, config);
    }
    printResult({
      asJson,
      success: true,
      title: result.title,
      payload: {
        project_root,
        ...result.payload,
      },
    });
  } catch (error) {
    printResult({
      asJson,
      success: false,
      title: "config command failed",
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    process.exitCode = 1;
  }
}

function applyCommonOptions(command: Command): Command {
  return command
    .option("--path <path>", t({
      zh: "项目根目录（默认当前目录）",
      en: "project root path (default: current directory)",
    }), ".")
    .option("--json [enabled]", t({
      zh: "以 JSON 输出",
      en: "output as JSON",
    }), parseBoolean, true);
}

/**
 * 注册 `city config` 命令组。
 */
export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description(t({
      zh: "管理 CLI 全局 DB 中的 Agent 配置与 alias",
      en: "manage Agent config in the CLI global DB and shell aliases",
    }))
    .helpOption("--help", helpText());

  applyCommonOptions(
    config
      .command("get [keyPath]")
      .description(t({
        zh: "读取 Agent 配置（可选读取单个路径）",
        en: "read Agent config, optionally from a single path",
      }))
      .helpOption("--help", helpText()),
  ).action((keyPath: string | undefined, options: { path?: string; json?: boolean }) => {
    runConfigCommand(options, ({ config: downcityConfig }) => {
      if (!keyPath) {
        return {
          title: "config loaded",
          payload: { config: downcityConfig },
        };
      }
      const pathTokens = parseConfigPath(keyPath);
      const got = getByPath(downcityConfig as unknown as Record<string, unknown>, pathTokens);
      if (!got.found) {
        throw new Error(`Config path not found: ${keyPath}`);
      }
      return {
        title: "config value loaded",
        payload: {
          keyPath,
          value: got.value,
        },
      };
    });
  });

  applyCommonOptions(
    config
      .command("set <keyPath> <value>")
      .description(t({
        zh: "设置 Agent 配置指定路径的值（value 支持 JSON 字面量）",
        en: "set a value at an Agent config path (value supports JSON literals)",
      }))
      .helpOption("--help", helpText()),
  ).action(
    (
      keyPath: string,
      value: string,
      options: { path?: string; json?: boolean },
    ) => {
      const pathTokens = parseConfigPath(keyPath);
      runConfigCommand(options, ({ config: downcityConfig }) => {
        const parsed = parseConfigValue(value);
        const changed = setByPath(
          downcityConfig as unknown as Record<string, unknown>,
          pathTokens,
          parsed,
        );
        return {
          title: "config value updated",
          save: true,
          payload: {
            keyPath,
            value: parsed,
            existed: changed.existed,
            previous: changed.previous,
          },
        };
      });
    },
  );

  applyCommonOptions(
    config
      .command("unset <keyPath>")
      .description(t({
        zh: "删除 Agent 配置指定路径",
        en: "remove a value at an Agent config path",
      }))
      .helpOption("--help", helpText()),
  ).action((keyPath: string, options: { path?: string; json?: boolean }) => {
    const pathTokens = parseConfigPath(keyPath);
    runConfigCommand(options, ({ config: downcityConfig }) => {
      const removed = unsetByPath(
        downcityConfig as unknown as Record<string, unknown>,
        pathTokens,
      );
      if (!removed.removed) {
        throw new Error(`Config path not found: ${keyPath}`);
      }
      return {
        title: "config value removed",
        save: true,
        payload: {
          keyPath,
          previous: removed.previous,
        },
      };
    });
  });

  config
    .command("alias")
    .description(t({
      zh: "在 .zshrc / .bashrc 中写入 Downcity 推荐 alias",
      en: "write recommended Downcity aliases into .zshrc / .bashrc",
    }))
    .option("--shell <shell>", t({
      zh: "指定写入的 shell: zsh | bash | both",
      en: "target shell to update: zsh | bash | both",
    }), "both")
    .option("--dry-run", t({
      zh: "只打印将要修改的文件，不实际写入",
      en: "print the files that would be changed without writing them",
    }), false)
    .option("--print", t({
      zh: "仅打印 alias 内容（用于 eval）",
      en: "print alias content only (for eval)",
    }), false)
    .helpOption("--help", helpText())
    .action(async (options: { shell?: string; dryRun?: boolean; print?: boolean }) => {
      await aliasCommand({
        shell: options.shell,
        dryRun: Boolean(options.dryRun),
        print: Boolean(options.print),
      });
    });
}
