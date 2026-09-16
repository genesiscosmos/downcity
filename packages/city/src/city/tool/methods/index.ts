/**
 * city tool method 装配入口。
 *
 * 关键点（中文）
 * - 新增一个 method 只需要新增一个子类文件，并在这里加一次登记。
 * - 登记顺序就是模型侧描述与索引的展示顺序，稳定优先。
 * - 只读事实与需要额度或文件的能力用同一套契约，区别只在各自声明的 `capability`。
 */

import type { CityMethod } from "@/city/tool/CityMethod.js";
import { AgentMethod } from "@/city/tool/methods/AgentMethod.js";
import { EnvMethod } from "@/city/tool/methods/EnvMethod.js";
import { ImageMethod } from "@/city/tool/methods/image/ImageMethod.js";
import { SandboxMethod } from "@/city/tool/methods/SandboxMethod.js";
import { SoundMethod } from "@/city/tool/methods/sound/SoundMethod.js";
import { UsageMethod } from "@/city/tool/methods/UsageMethod.js";
import { WorkspacesMethod } from "@/city/tool/methods/WorkspacesMethod.js";

/** 创建全部内置 method。 */
export function create_city_tool_methods(): CityMethod[] {
  return [
    new EnvMethod(),
    new SandboxMethod(),
    new WorkspacesMethod(),
    new AgentMethod(),
    new UsageMethod(),
    new ImageMethod(),
    new SoundMethod(),
  ];
}
