/**
 * Downcity 官方 City Power 注册集合。
 *
 * 每个官方 Power 直接提供一个唯一实例；City 持有实例生命周期，Desktop 使用同一
 * Power 实例在 start 阶段直接装配 Mainview/Config action。
 */

import { fileURLToPath } from "node:url";
import type { CityPowerRegistration } from "@downcity/city/power";
import { ChatPower } from "@/chat.js";
import { MemoryPower } from "@/memory.js";
import { SkillPower } from "@/skill.js";
import { TaskPower } from "@/task.js";
import { WebPower } from "@/web.js";

/** 官方 Power definition 与 @downcity/city/power 的统一注册协议一致。 */
export type BuiltinPowerDefinition = CityPowerRegistration;

/** 官方 Power 注册由 CityPowerRegistration 直接表达。 */
export type BuiltinPowerRegistration = CityPowerRegistration;

/** 创建 Downcity 官方 Power 注册集合。 */
export function create_builtin_power_registrations(): BuiltinPowerRegistration[] {
  return [
    {
      readme: builtin_readme_path("skill"),
      has_config: false,
      has_sidebar: true,
      has_mainview: true,
      power: new SkillPower(),
    },
    {
      readme: builtin_readme_path("task"),
      has_config: false,
      has_sidebar: true,
      has_mainview: true,
      power: new TaskPower(),
    },
    {
      readme: builtin_readme_path("chat"),
      has_config: false,
      has_sidebar: true,
      has_mainview: true,
      power: new ChatPower(),
    },
    {
      readme: builtin_readme_path("memory"),
      has_config: false,
      has_sidebar: true,
      has_mainview: true,
      power: new MemoryPower(),
    },
    {
      readme: builtin_readme_path("web"),
      has_config: true,
      has_sidebar: true,
      has_mainview: true,
      power: new WebPower(),
    },
  ];
}

/** 返回随 package 发布的官方 Power Markdown 用户文档绝对路径。 */
function builtin_readme_path(power_id: string): string {
  return fileURLToPath(new URL(`../../readmes/${power_id}.readme.md`, import.meta.url));
}
