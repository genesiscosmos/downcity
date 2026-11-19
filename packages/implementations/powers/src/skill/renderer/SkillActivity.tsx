/** Skill 说明与 MCP 回执遵循各自契约；外部工具未知结构不转为 JSON 详情。 */
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "@downcity/city/power/react";
import { ActivityText, action_of, args_of, call_tone, chinese, data_of, error_of, preview } from "@/builtin/renderer/ActivityContent.js";

/** 每个动作的完整已完成句子。 */
const completed: Readonly<Record<string, readonly [string, string]>> = {
  "": ["已读取 Skill 动作", "Skill actions read"], list: ["已列出可用技能", "Available skills listed"],
  lookup: ["技能说明已读取", "Skill instructions read"], servers: ["已列出外部服务", "External servers listed"],
  tools: ["已查看外部工具", "External tools inspected"], call: ["外部工具已返回", "External tool returned"],
};
/** 进行时句子同样归 Skill 所有。 */
const running: Readonly<Record<string, readonly [string, string]>> = {
  list: ["正在查找可用技能", "Finding available skills"], lookup: ["正在读取技能说明", "Reading skill instructions"],
  servers: ["正在查看外部服务", "Inspecting external servers"], tools: ["正在读取外部工具说明", "Reading external tool descriptions"],
  call: ["正在调用外部工具", "Calling external tool"],
};

/** MCP 成功不代表某个外部业务已完成；没有阅读协议时保持单行。 */
function describe(props: PowerActivityProps): PowerActivityDescription {
  const action = action_of(props);
  const data = data_of(props);
  const args = args_of(props);
  const tone = data.success === false || data.isError === true ? "failed" : call_tone(props);
  let sentence = (tone === "complete" ? completed[action] : running[action]) ?? ["技能操作已返回", "Skill operation returned"];
  if (tone === "failed") sentence = action === "call" ? ["外部工具调用失败", "External tool call failed"] : ["技能操作失败", "Skill operation failed"];
  if (tone === "waiting") sentence = ["技能操作等待确认", "Skill operation awaiting confirmation"];
  if (props.tool.state === "input-streaming") sentence = ["正在准备技能操作", "Preparing skill operation"];
  return { title: sentence[chinese(props.locale) ? 0 : 1]!, tone, summary: preview(args.name),
    has_detail: ["lookup", "call"].includes(action) && Boolean(error_of(props)) };
}
/** 只有技能说明及明确错误成为用户正文，不显示 MCP arguments。 */
function detail(props: PowerActivityProps) { return <ActivityText render_text={props.render_text} error={error_of(props)} />; }
/** Skill 自有插槽。 */
export const SKILL_ACTIVITY_RENDERER: PowerActivityRenderer = { describe, detail };
