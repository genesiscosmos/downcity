/** City Power 的交互式制品管理器。 */

import prompts from "@/city/tui/Prompts.js";
import { PowerManagement, type ManagedPower } from "./PowerManagement.js";
import { emitCliBlock } from "@/shared/CliReporter.js";

/** 打开 City 全局 Power 管理器。 */
export async function run_interactive_power_manager(): Promise<void> {
  while (true) {
    const manager = new PowerManagement();
    const catalog = await manager.list();
    const response = await prompts({
      type: "select",
      name: "selection",
      message: "Powers",
      choices: [
        ...catalog.map((power) => ({
          title: power.title,
          description: [power.power_id, power.kind, power.status].join(" · "),
          value: `power:${power.power_id}`,
        })),
        { title: "操作", disabled: true },
        { title: "安装 Power", description: "从本地目录、Git URL 或 GitHub 安装", value: "install" },
        { title: "返回", value: "back" },
      ],
    });
    const selection = String(response.selection || "");
    if (!selection || selection === "back") return;
    if (selection === "install") {
      await run_interactive_install();
      continue;
    }
    const power_id = selection.startsWith("power:") ? selection.slice(7) : "";
    const power = await manager.resolve(power_id);
    if (power) await run_interactive_power_actions(power);
  }
}

/** 管理一个 Power 的全局配置与制品。 */
async function run_interactive_power_actions(power: ManagedPower): Promise<void> {
  const response = await prompts({
    type: "select",
    name: "action",
    message: power.title,
    subtitle: power.description,
    choices: [
      { title: "配置说明", description: "使用 city power config 管理配置", value: "config" },
      ...(power.kind !== "builtin"
        ? [
            { title: "更新", description: "从已保存来源更新 Power", value: "update" },
            { title: "卸载", description: "删除本地 Power 制品", value: "uninstall" },
          ]
        : []),
      { title: "返回", value: "back" },
    ],
  });
  if (response.action === "config") {
    emitCliBlock({
      tone: "info",
      title: "Power config",
      summary: power.power_id,
      note: `使用 city power config ${power.power_id} --set 写入完整配置。代码来源的配置需通过 city power reload 应用。`,
    });
  }
  if (response.action === "update") {
    const installed = await new PowerManagement().refresh(power.power_id);
    emitCliBlock({ tone: installed.details?.error ? "error" : "info", title: `Power ${installed.status}`, summary: installed.power_id });
  }
  if (response.action === "uninstall") {
    const confirmed = await prompts({
      type: "confirm",
      name: "confirmed",
      message: `卸载 ${power.power_id}？`,
      initial: false,
    });
    if (confirmed.confirmed === true) {
      const removed = await new PowerManagement().uninstall(power.power_id);
      emitCliBlock({ tone: removed.details?.error ? "error" : "info", title: `Power ${removed.status}`, summary: removed.power_id });
    }
  }
}

/** 安装一个用户显式信任的 Power。 */
async function run_interactive_install(): Promise<void> {
  const source_response = await prompts({
    type: "text",
    name: "source",
    message: "Power 来源",
    subtitle: "本地目录、Git URL 或 github:owner/repo#ref",
  });
  const source = String(source_response.source || "").trim();
  if (!source) return;
  const trust_response = await prompts({
    type: "confirm",
    name: "trusted",
    message: "确认信任并安装该 Power 代码？",
    initial: false,
  });
  if (trust_response.trusted !== true) return;
  const installed = await new PowerManagement().install(source);
  emitCliBlock({ tone: installed.details?.error ? "error" : "info", title: `Power ${installed.status}`, summary: installed.power_id });
}
