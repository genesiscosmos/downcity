/**
 * City 本地 Agent 装配工厂。
 *
 * 该工厂统一 Agent、Workspace、Shell 与默认工具的构造顺序。Registry、模型目录、
 * Plugin Binding 和平台 Sandbox 的选择仍由宿主负责并显式注入。
 */

import { Agent } from "@/agent/Agent.js";
import { AskQuestionsTool } from "@/tools/ask/AskQuestionsTool.js";
import type { CreateCityAgentInput } from "@/types/city/CityAgentFactory.js";
import { Workspace } from "@/workspace/Workspace.js";
import { Shell } from "@downcity/shell";

/** 创建一个已装配但尚未等待 ready 的本地 Agent。 */
export function create_city_agent(input: CreateCityAgentInput): Agent {
  const agent_id = String(input.agent_id || "").trim();
  if (!agent_id) throw new Error("agent_id is required");
  const workspace_path = String(input.workspace_path || "").trim();
  if (!workspace_path) throw new Error("workspace_path is required");
  const workspace = new Workspace({
    path: workspace_path,
    shell: new Shell({ sandbox: input.sandbox }),
    env: input.env,
  });
  return new Agent({
    id: agent_id,
    workspace,
    model: input.model,
    plugins: input.plugins ?? [],
    tools: {
      ask_question: AskQuestionsTool,
    },
  });
}
