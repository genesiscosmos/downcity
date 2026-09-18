/**
 * city power 动作组装配入口。
 *
 * 关键点（中文）
 * - 新增一个动作组只需要新增一个子类文件，并在这里加一次登记。
 * - 登记顺序就是模型侧描述与索引的展示顺序，稳定优先。
 * - 只读事实与需要额度或文件的能力用同一套契约，区别只在各自声明的 `access`。
 */

import type { CityActionGroup } from "@/city/power/builtin/CityActionGroup.js";
import { AgentGroup } from "@/city/power/builtin/groups/AgentGroup.js";
import { EnvGroup } from "@/city/power/builtin/groups/EnvGroup.js";
import { ImageGroup } from "@/city/power/builtin/groups/image/ImageGroup.js";
import { SandboxGroup } from "@/city/power/builtin/groups/SandboxGroup.js";
import { SoundGroup } from "@/city/power/builtin/groups/sound/SoundGroup.js";
import { UsageGroup } from "@/city/power/builtin/groups/UsageGroup.js";
import { WorkspacesGroup } from "@/city/power/builtin/groups/WorkspacesGroup.js";

/** 创建全部内置动作组。 */
export function create_city_action_groups(): CityActionGroup[] {
  return [
    new EnvGroup(),
    new SandboxGroup(),
    new WorkspacesGroup(),
    new AgentGroup(),
    new UsageGroup(),
    new ImageGroup(),
    new SoundGroup(),
  ];
}
