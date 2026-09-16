/**
 * city tool namespace 装配入口。
 *
 * 关键点（中文）
 * - 新增一个 namespace 只需要新增一个子类文件，并在这里加一次注册。
 * - 注册顺序就是模型侧描述与索引的展示顺序，稳定优先。
 */

import type { CityNamespace } from "@/city/tool/namespaces/CityNamespace.js";
import { AgentNamespace } from "@/city/tool/namespaces/AgentNamespace.js";
import { EnvNamespace } from "@/city/tool/namespaces/EnvNamespace.js";
import { SandboxNamespace } from "@/city/tool/namespaces/SandboxNamespace.js";
import { UsageNamespace } from "@/city/tool/namespaces/UsageNamespace.js";
import { WorkspacesNamespace } from "@/city/tool/namespaces/WorkspacesNamespace.js";

/** 创建第一期全部 namespace。 */
export function create_city_tool_namespaces(): CityNamespace[] {
  return [
    new EnvNamespace(),
    new SandboxNamespace(),
    new WorkspacesNamespace(),
    new AgentNamespace(),
    new UsageNamespace(),
  ];
}
