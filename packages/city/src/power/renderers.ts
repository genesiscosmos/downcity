/**
 * City 自有 Power 的浏览器安全 Renderer 注册表。
 * 以稳定 power_id 注册 activity-only 或其他 UI Renderer；不得导入后端 Power 实现。
 * Shell 与 Session 提供按需详情，其他 Power 提供自身单行语义，宿主无须增加工具分支。
 */
import { SESSION_INPUT_RENDERER } from "./renderer/SessionInput.js";
import { SHELL_INPUT_RENDERER } from "./renderer/ShellInput.js";
import type { PowerRendererDefinition } from "./types/PowerRenderer.js";
import { SHELL_ACTIVITY_RENDERER } from "./renderer/ShellActivity.js";
import { SESSION_ACTIVITY_RENDERER } from "./renderer/SessionActivity.js";
import { CONTEXT_ACTIVITY_RENDERER, AI_ACTIVITY_RENDERER, AGENT_ACTIVITY_RENDERER } from "./renderer/BuiltinActivity.js";

/** City 自有 Power ID 到 Renderer 的静态映射，与可安装 Power registry 使用同一契约。 */
export const CITY_POWER_RENDERERS: Readonly<Record<string, PowerRendererDefinition>> = {
  shell: { input: SHELL_INPUT_RENDERER, activity: SHELL_ACTIVITY_RENDERER },
  session: { input: SESSION_INPUT_RENDERER, activity: SESSION_ACTIVITY_RENDERER },
  context: { activity: CONTEXT_ACTIVITY_RENDERER },
  ai: { activity: AI_ACTIVITY_RENDERER },
  agent: { activity: AGENT_ACTIVITY_RENDERER },
};
