/**
 * `city plugin` 命令组辅助函数。
 *
 * 关键点（中文）
 * - `city plugin` 提供 Agent 内部 plugin 目录入口。
 * - `list/info` 不依赖 agent，只展示内建 plugin 定义事实。
 * - City 不承载 plugin 运行态；运行态归属于具体 agent。
 * - `action` 仍保留为高级入口，真正执行时依赖具体 agent 项目。
 */

import prompts from "@/city/tui/Prompts.js";
import {
  list_plugin_views,
  list_plugins_with_lifecycle,
  list_plugins_without_lifecycle,
} from "@downcity/agent";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import type { JsonValue, PluginCliBaseOptions } from "@downcity/agent";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { t } from "@/shared/CliLocale.js";
import { resolveProjectRoot } from "@/city/shared/PluginTargetSupport.js";
import { createCityStaticBuiltinPlugins } from "@/city/runtime/plugins/CityBuiltinPlugins.js";
import { readAgentConfig } from "@/city/process/registry/AgentConfigStore.js";

type StaticCatalogEntry = {
  name: string;
  title: string;
  kind: "agent-runtime" | "action";
  actionCount: number;
  actions: string[];
  has_system: boolean;
  note?: string;
};

const CHAT_RUNTIME_ACTIONS_HIDDEN_FROM_CITY = new Set([
  "status",
  "test",
  "reconnect",
]);

const CONTACT_REMOTE_ACTIONS_HIDDEN_FROM_CITY = new Set([
  "remoteping",
  "remoteapprove",
  "remoteconfirm",
  "remotechat",
  "remoteshare",
]);

export function createPluginCatalog() {
  return createCityStaticBuiltinPlugins();
}

export function createVisiblePluginCatalog() {
  return createPluginCatalog();
}

export function listVisiblePluginActions(plugin_name: string, actions: string[]): string[] {
  if (plugin_name === "chat") {
    // 关键点（中文）：City 只展示 chat plugin 的用户操作能力，不展示 platform 运行态控制。
    return actions.filter((action) => !CHAT_RUNTIME_ACTIONS_HIDDEN_FROM_CITY.has(action));
  }
  if (plugin_name === "contact") {
    // 关键点（中文）：remote* action 是 agent-to-agent 内部协议入口，不作为普通用户 action 展示。
    return actions.filter((action) => !CONTACT_REMOTE_ACTIONS_HIDDEN_FROM_CITY.has(action));
  }
  return actions;
}

export async function resolvePluginProjectRoot(options: PluginCliBaseOptions): Promise<{
  project_root?: string;
  error?: string;
}> {
  return { project_root: resolveProjectRoot(options.path) };
}

export function validatePluginProjectRoot(project_root: string): string | null {
  return readAgentConfig(project_root)
    ? null
    : `Invalid plugin project path: ${project_root}. Missing agent config. Run \`city agent create\` first.`;
}

export function parseCommandPayload(raw?: string): JsonValue | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}

export function stripAnsi(input: string): string {
  return String(input || "").replace(/\u001b\[[0-9;]*m/g, "");
}

export function truncateCell(input: string, width: number): string {
  const text = String(input || "");
  if (stripAnsi(text).length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

export function renderPluginCatalogTable(rows: Array<{
  name: string;
  title: string;
  kind: "agent-runtime" | "action";
  actionCount: number;
  has_system: boolean;
}>): void {
  if (rows.length === 0) {
    emitCliBlock({
      tone: "info",
      title: "Plugin catalog",
      summary: "0 plugins",
    });
    return;
  }

  const headers = ["plugin", "kind", "actions", "system", "title"] as const;
  const dataRows = rows.map((row) => [
    row.name,
    row.kind,
    String(row.actionCount),
    row.has_system ? "yes" : "no",
    row.title,
  ]);
  const widths = headers.map((header, index) =>
    Math.max(
      header.length,
      ...dataRows.map((row) => stripAnsi(String(row[index] || "")).length),
    ),
  );
  widths[4] = Math.min(Math.max(widths[4], 16), 44);

  const renderRow = (values: string[]): string =>
    values
      .map((value, index) => truncateCell(value, widths[index]).padEnd(widths[index], " "))
      .join("  ");

  console.log(renderRow([...headers]));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of dataRows) {
    console.log(renderRow(row));
  }
}

export function listStaticCatalogEntries(): StaticCatalogEntry[] {
  const plugins = createVisiblePluginCatalog();
  const managedEntries = list_plugins_with_lifecycle(plugins).map((plugin) => {
    const actions = listVisiblePluginActions(
      plugin.name,
      Object.keys(plugin.actions || {}).sort((left, right) => left.localeCompare(right)),
    );
    return {
      name: plugin.name,
      title: String(plugin.title || plugin.name || "").trim() || plugin.name,
      kind: "agent-runtime" as const,
      actionCount: actions.length,
      actions,
      has_system: typeof plugin.system === "function",
      note: "Runs inside an agent. City only shows the catalog here; runtime is owned by the agent process.",
    };
  });

  const localPlugins = list_plugins_without_lifecycle(plugins);
  const localEntries = list_plugin_views(localPlugins).map((plugin) => {
    return {
      name: plugin.name,
      title: plugin.title,
      kind: "action" as const,
      actionCount: plugin.actions.length,
      actions: [...plugin.actions],
      has_system: plugin.has_system,
      note: "Action/system plugin. It runs through agent/plugin action execution, not City runtime.",
    };
  });

  const merged = [...managedEntries, ...localEntries];
  const unique = new Map<string, StaticCatalogEntry>();
  for (const entry of merged) {
    if (!unique.has(entry.name)) {
      unique.set(entry.name, entry);
    }
  }
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function findStaticCatalogEntry(plugin_name: string): StaticCatalogEntry | null {
  return listStaticCatalogEntries().find((item) => item.name === plugin_name) || null;
}

type plugin_manager_selection =
  | {
      /** 选择类型：进入 Chat 共享资源管理器。 */
      type: "chat";
    }
  | {
      /** 选择类型：查看某个 Plugin。 */
      type: "plugin";

      /** 目标 Plugin 名称。 */
      plugin_name: string;
    }
  | {
      /** 选择类型：退出 Plugin 管理器。 */
      type: "exit";
    };

export function formatPluginDescription(plugin: StaticCatalogEntry): string {
  return t({
    zh: [
      `${plugin.kind} · ${plugin.actionCount} 个 action · System ${plugin.has_system ? "yes" : "no"}`,
      "Enter 查看完整能力详情。",
    ].filter(Boolean).join("\n"),
    en: [
      `${plugin.kind} · ${plugin.actionCount} actions · System ${plugin.has_system ? "yes" : "no"}`,
      "Press Enter to inspect details.",
    ].filter(Boolean).join("\n"),
  });
}

export async function promptPluginSelection(): Promise<plugin_manager_selection | null> {
  const plugins = listStaticCatalogEntries();
  const response = (await prompts({
    type: "select",
    name: "selection",
    message: t({
      zh: "Plugin 能力",
      en: "Plugin capabilities",
    }),
    choices: [
      {
        title: t({ zh: "共享资源", en: "Shared resources" }),
        disabled: true,
      },
      {
        title: t({ zh: "Chat", en: "Chat" }),
        description: t({
          zh: "管理 City 级 Chat 账号与共享会话。",
          en: "Manage City-level Chat accounts and shared sessions.",
        }),
        value: {
          type: "chat" as const,
        },
      },
      {
        title: t({ zh: "Plugin 列表", en: "Plugins" }),
        disabled: true,
      },
      ...plugins.map((plugin) => ({
        title: plugin.name,
        description: formatPluginDescription(plugin),
        value: {
          type: "plugin" as const,
          plugin_name: plugin.name,
        },
      })),
      {
        title: t({ zh: "导航", en: "Navigation" }),
        disabled: true,
      },
      {
        title: t({ zh: "退出", en: "Exit" }),
        description: t({
          zh: "关闭 Plugin 能力管理器，返回终端。",
          en: "Close the Plugin capability manager and return to the terminal.",
        }),
        value: {
          type: "exit" as const,
        },
      },
    ],
    initial: 1,
  })) as { selection?: plugin_manager_selection };

  return response.selection || null;
}

export async function promptPluginName(message: string): Promise<string | null> {
  const plugins = listStaticCatalogEntries();
  const response = (await prompts({
    type: "select",
    name: "plugin_name",
    message,
    choices: plugins.map((plugin) => ({
      title: plugin.name,
      description: t({
        zh: `${plugin.title || plugin.name} · ${plugin.kind} · ${plugin.actionCount} 个 action。${plugin.note || ""}`,
        en: `${plugin.title || plugin.name} · ${plugin.kind} · ${plugin.actionCount} actions. ${plugin.note || ""}`,
      }),
      value: plugin.name,
    })),
    initial: 0,
  })) as { plugin_name?: string };
  const plugin_name = String(response.plugin_name || "").trim();
  return plugin_name || null;
}

export async function resolveInteractivePluginName(params: {
  plugin_name?: string;
  message: string;
}): Promise<string | null> {
  const explicit = String(params.plugin_name || "").trim();
  if (explicit) return explicit;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    emitCliBlock({
      tone: "error",
      title: "Plugin name is required",
      note: "Use `city plugin info <plugin_name>` or run this command in an interactive terminal.",
    });
    return null;
  }

  const selected = await promptPluginName(params.message);
  if (!selected) {
    emitCliBlock({
      tone: "info",
      title: "Plugin selection cancelled",
    });
    return null;
  }
  return selected;
}

export async function runPluginListCommand(options: { json?: boolean }): Promise<void> {
  const plugins = listStaticCatalogEntries();
  if (options.json !== true) {
    renderPluginCatalogTable(
      plugins.map((plugin) => ({
        name: plugin.name,
        title: plugin.title,
        kind: plugin.kind,
        actionCount: plugin.actionCount,
        has_system: plugin.has_system,
      })),
    );
    return;
  }
  printResult({
    asJson: true,
    success: true,
    title: "plugins listed",
    payload: {
      plugins,
    },
  });
}

export async function runPluginInfoCommand(params: {
  plugin_name?: string;
  options: { json?: boolean };
}): Promise<void> {
  const plugin_name = await resolveInteractivePluginName({
    plugin_name: params.plugin_name,
    message: t({
      zh: "选择要查看的 Plugin",
      en: "Select a plugin to inspect",
    }),
  });
  if (!plugin_name) {
    return;
  }

  const plugin = findStaticCatalogEntry(plugin_name);
  if (!plugin) {
    printResult({
      asJson: params.options.json === true,
      success: false,
      title: "plugin info failed",
      payload: {
        error: `Unknown plugin: ${plugin_name}`,
      },
    });
    return;
  }

  if (params.options.json !== true) {
    emitCliBlock({
      tone: "info",
      title: `Plugin ${plugin_name}`,
      summary: plugin.kind,
      facts: [
        {
          label: "title",
          value: plugin.title || plugin_name,
        },
        {
          label: "kind",
          value: plugin.kind,
        },
        {
          label: "actions",
          value: plugin.actions.join(", ") || "none",
        },
        {
          label: "system",
          value: plugin.has_system ? "yes" : "no",
        },
        ...(plugin.note
          ? [
              {
                label: "note",
                value: plugin.note,
              },
            ]
          : []),
      ],
    });
    return;
  }

  printResult({
    asJson: true,
    success: true,
    title: "plugin info ok",
    payload: {
      plugin_name,
      plugin,
    },
  });
}
