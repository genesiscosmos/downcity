/**
 * `city env` 命令树。
 *
 * 关键点（中文）
 * - `env` 是平台 Env 的资源命令，支持 list/set/delete。
 * - 默认不输出任何 secret value；只在显式 set 时写入值。
 * - 当前只保留平台全局 env，不再区分 agent 私有层。
 */

import type { Command } from "commander";
import { PlatformStore } from "@/city/runtime/store/index.js";
import type { StoredEnvEntry } from "@/city/types/platform/PlatformStore.js";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import { parseBoolean } from "@/shared/IndexSupport.js";
import { helpText, t } from "@/shared/CliLocale.js";

/**
 * 规范化 env key。
 */
function normalizeEnvKey(value: string): string {
  const key = String(value || "").trim().toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
    throw new Error(`Invalid env key: ${value}`);
  }
  return key;
}

/**
 * 把 env value 格式化成 `.env` 可解析的值。
 *
 * 关键点（中文）
 * - 简单值保持裸值，便于用户直接阅读。
 * - 包含空白、引号、换行等特殊字符时使用双引号并转义。
 * - 空字符串输出为空值：`KEY=`。
 */
function formatDotenvValue(value: string): string {
  const text = String(value ?? "");
  if (!text) return "";
  if (/^[A-Za-z0-9_./:@+-]+$/.test(text)) {
    return text;
  }
  return `"${text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/"/g, "\\\"")}"`;
}

/**
 * 把平台 Env 条目输出为 dotenv 文件内容。
 */
function formatDotenvEntries(entries: StoredEnvEntry[]): string {
  if (entries.length === 0) return "";
  return `${entries
    .map((item) => `${item.key}=${formatDotenvValue(item.value)}`)
    .join("\n")}\n`;
}

/**
 * 判断当前命令是否处在 agent shell 执行上下文。
 *
 * 关键点（中文）
 * - agent shell 会注入 `DC_AGENT_PATH/DC_AGENT_ID`，用于嵌套 City CLI 定位当前 agent。
 * - `env copy` 会导出 secret 明文，不能允许 agent 自己调用。
 */
function isAgentShellExecution(): boolean {
  return Boolean(
    String(process.env.DC_AGENT_PATH || "").trim() ||
      String(process.env.DC_AGENT_ID || "").trim(),
  );
}

/**
 * 限制 `city env copy` 只能由本机 CLI 执行。
 */
function assertEnvCopyAllowedFromLocalCli(): void {
  if (!isAgentShellExecution()) return;
  throw new Error("city env copy can only be run from the local CLI, not from an agent shell.");
}

async function listKeysEntries(): Promise<StoredEnvEntry[]> {
  const store = new PlatformStore();
  try {
    return await store.listEnvEntries();
  } finally {
    store.close();
  }
}

/**
 * 输出 env 列表。
 */
async function emitKeysList(params: {
  /**
   * 是否以 JSON 输出。
   */
  asJson?: boolean;
}): Promise<void> {
  const entries = await listKeysEntries();

  if (params.asJson === true) {
    printResult({
      asJson: true,
      success: true,
      title: "env list",
      payload: {
        count: entries.length,
        keys: entries.map((item) => ({
          key: item.key,
          description: item.description || "",
          scope: item.scope,
          created_at: item.created_at,
          updated_at: item.updated_at,
        })),
      },
    });
    return;
  }

  if (entries.length === 0) {
    emitCliBlock({
      tone: "info",
      title: "Env",
      summary: "0 configured",
      note: "No platform env entry matched the current filter.",
    });
    return;
  }

  emitCliList({
    tone: "accent",
    title: "Env",
    summary: `${entries.length} configured`,
    items: entries.map((item) => ({
      tone: "info",
      title: item.key,
      facts: [
        {
          label: "Scope",
          value: "global",
        },
        ...(item.description
          ? [
              {
                label: "Description",
                value: item.description,
              },
            ]
          : []),
      ],
    })),
  });
}

/**
 * 输出 dotenv 格式的 env 内容。
 */
async function emitDotenvCopy(): Promise<void> {
  const entries = await listKeysEntries();
  process.stdout.write(formatDotenvEntries(entries));
}

/**
 * 写入单个 env 条目。
 */
async function setKeyEntry(params: {
  /**
   * env key。
   */
  key: string;
  /**
   * env value。
   */
  value: string;
  /**
   * 描述。
   */
  description?: string;
  /**
   * 是否以 JSON 输出。
   */
  asJson?: boolean;
}): Promise<void> {
  const store = new PlatformStore();
  try {
    await store.upsertEnvEntry({
      scope: "global",
      key: params.key,
      value: params.value,
      description: String(params.description || "").trim(),
    });
  } finally {
    store.close();
  }

  if (params.asJson === true) {
    printResult({
      asJson: true,
      success: true,
      title: "env set",
      payload: {
        action: "set",
        scope: "global",
        key: params.key,
      },
    });
    return;
  }

  emitCliBlock({
    tone: "success",
    title: "Key saved",
    summary: params.key,
    facts: [
      {
        label: "Scope",
        value: "global",
      },
      ...(params.description
        ? [
            {
              label: "Description",
              value: params.description,
            },
          ]
        : []),
    ],
  });
}

/**
 * 删除单个 env 条目。
 */
function deleteKeyEntry(params: {
  /**
   * env key。
   */
  key: string;
  /**
   * 是否以 JSON 输出。
   */
  asJson?: boolean;
}): void {
  const store = new PlatformStore();
  try {
    store.removeEnvEntry(params.key);
  } finally {
    store.close();
  }

  if (params.asJson === true) {
    printResult({
      asJson: true,
      success: true,
      title: "env delete",
      payload: {
        action: "delete",
        scope: "global",
        key: params.key,
      },
    });
    return;
  }

  emitCliBlock({
    tone: "success",
    title: "Key deleted",
    summary: params.key,
    facts: [
      {
        label: "Scope",
        value: "global",
      },
    ],
  });
}

/**
 * 注册 `city env` 命令组。
 */
export function registerEnvCommand(program: Command): void {
  const env = program
    .command("env")
    .description(t({
      zh: "管理平台 Env 中的 key",
      en: "manage keys in the platform Env store",
    }))
    .helpOption("--help", helpText());

  env
    .command("list")
    .description(t({
      zh: "列出平台 Env 中已配置的 key",
      en: "list configured keys in the platform Env store",
    }))
    .option("--json [enabled]", t({
      zh: "以 JSON 输出",
      en: "output as JSON",
    }), parseBoolean)
    .helpOption("--help", helpText())
    .action(async (options: { json?: boolean }) => {
      await emitKeysList({
        asJson: options.json === true,
      });
    });

  env
    .command("set <key> <value>")
    .description(t({
      zh: "新增或更新平台 Env 中的 key",
      en: "create or update a key in the platform Env store",
    }))
    .option("-d, --description <description>", t({
      zh: "设置 key 描述",
      en: "set a description for the key",
    }))
    .option("--json [enabled]", t({
      zh: "以 JSON 输出",
      en: "output as JSON",
    }), parseBoolean)
    .helpOption("--help", helpText())
    .action(async (
      keyInput: string,
      valueInput: string,
      options: { description?: string; json?: boolean },
    ) => {
      await setKeyEntry({
        key: normalizeEnvKey(keyInput),
        value: String(valueInput ?? ""),
        description: String(options.description || "").trim(),
        asJson: options.json === true,
      });
    });

  env
    .command("copy")
    .description(t({
      zh: "按 .env 文件格式输出平台 Env 的明文值",
      en: "print platform Env values in .env file format",
    }))
    .helpOption("--help", helpText())
    .action(async () => {
      assertEnvCopyAllowedFromLocalCli();
      await emitDotenvCopy();
    });

  env
    .command("delete <key>")
    .description(t({
      zh: "删除平台 Env 中的 key",
      en: "delete a key from the platform Env store",
    }))
    .option("--json [enabled]", t({
      zh: "以 JSON 输出",
      en: "output as JSON",
    }), parseBoolean)
    .helpOption("--help", helpText())
    .action(async (
      keyInput: string,
      options: { json?: boolean },
    ) => {
      deleteKeyEntry({
        key: normalizeEnvKey(keyInput),
        asJson: options.json === true,
      });
    });

  env.action(async () => {
    await emitKeysList({});
  });

  env.showHelpAfterError();
  env.showSuggestionAfterError();
}
