/**
 * city tool namespace 装配入口。
 *
 * 关键点（中文）
 * - 新增一个 namespace 只需要新增 provider 文件，并在这里加一次注册。
 * - 注册顺序就是模型侧描述与索引的展示顺序，稳定优先。
 */

import type { CityToolNamespaceProvider } from "@/city/types/CityTool.js";
import { create_agent_namespace } from "@/city/tool/namespaces/AgentNamespace.js";
import { create_env_namespace } from "@/city/tool/namespaces/EnvNamespace.js";
import { create_sandbox_namespace } from "@/city/tool/namespaces/SandboxNamespace.js";
import { create_usage_namespace } from "@/city/tool/namespaces/UsageNamespace.js";
import { create_workspaces_namespace } from "@/city/tool/namespaces/WorkspacesNamespace.js";

/** 创建第一期全部 namespace provider。 */
export function create_city_tool_namespaces(): CityToolNamespaceProvider[] {
  return [
    create_env_namespace(),
    create_sandbox_namespace(),
    create_workspaces_namespace(),
    create_agent_namespace(),
    create_usage_namespace(),
  ];
}
