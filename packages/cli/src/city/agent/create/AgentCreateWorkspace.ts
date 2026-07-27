/**
 * `city agent create` Workspace 选择逻辑。
 *
 * 显式路径直接解析；完全没有路径参数时才展示当前目录与系统文件夹选择窗口。
 */

import path from "node:path";

import { pick_native_directory } from "@/city/agent/create/NativeDirectoryPicker.js";
import prompts from "@/city/tui/Prompts.js";
import { CliError } from "@/shared/CliError.js";
import type {
  AgentCreateWorkspaceMode,
  ResolveAgentCreateWorkspaceInput,
} from "@/city/types/agent/AgentCreateWorkspace.js";

/** 解析命令参数或交互选择得到的 Agent Workspace。 */
export async function resolve_agent_create_workspace(
  input: ResolveAgentCreateWorkspaceInput,
): Promise<string | null> {
  const current_directory = path.resolve(input.current_directory);
  const path_argument = String(input.path_argument || "").trim();
  if (path_argument) {
    return path.resolve(current_directory, path_argument);
  }
  if (!input.interactive) {
    throw new CliError({
      title: "Agent Workspace requires an interactive terminal",
      note: "No path was provided, so Downcity cannot open the interactive Workspace chooser.",
      fix: "city agent create .",
    });
  }

  const mode = await input.select_mode();
  if (mode === "current") return current_directory;
  if (mode !== "choose") return null;
  const selected_directory = await input.pick_directory(current_directory);
  return selected_directory ? path.resolve(selected_directory) : null;
}

/** 使用真实终端和系统窗口选择 Agent Workspace。 */
export async function select_agent_create_workspace(
  path_argument?: string,
): Promise<string | null> {
  const current_directory = process.cwd();
  return await resolve_agent_create_workspace({
    path_argument,
    current_directory,
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    select_mode: async () => await prompt_workspace_mode(current_directory),
    pick_directory: pick_native_directory,
  });
}

/** 选择当前目录或打开系统原生文件夹窗口。 */
async function prompt_workspace_mode(
  current_directory: string,
): Promise<AgentCreateWorkspaceMode | null> {
  const response = (await prompts({
    type: "select",
    name: "mode",
    message: "Select Agent Workspace",
    subtitle: current_directory,
    choices: [
      {
        title: "Use current directory",
        description: current_directory,
        value: "current",
      },
      {
        title: "Choose another directory…",
        description: "Open the system folder picker",
        value: "choose",
      },
    ],
    initial: 0,
  })) as { mode?: AgentCreateWorkspaceMode };
  return response.mode || null;
}
