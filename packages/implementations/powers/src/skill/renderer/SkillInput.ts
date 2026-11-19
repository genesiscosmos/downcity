/** Skill lookup 的正文实际通过 tool_media/context tag=skill 注入，不存在于工具 data。 */
import { createElement as create_element } from "react";
import type { PowerInputProps, PowerInputDetailProps, PowerInputRenderer } from "@downcity/city/power/react";
import { chinese } from "@/builtin/renderer/ActivityContent.js";

/** 只解释 Skill.Power.lookup 明确的来源头；损坏或未知结构不输出。 */
function instruction(props: PowerInputProps): string {
  if (props.input.kind !== "tool_media") return "";
  const part = props.input.content.find(item => item.type === "context" && item.tag === "skill");
  if (!part || part.type !== "context") return "";
  const content = part.context;
  const header_end = content.slice(0, 4_000).indexOf("\n\n");
  if (!content.startsWith("name: ") || header_end < 0) return "";
  return content.slice(header_end + 2, header_end + 48_002);
}

/** 技能正文可读时才提供展开，不显示 context tag/path/id。 */
function describe(props: PowerInputProps) {
  if (!instruction(props).trim()) return null;
  const part = props.input.content.find(item => item.type === "context" && item.tag === "skill");
  const name = part?.type === "context" ? /^name: ([^\r\n]+)/.exec(part.context.slice(0, 4_000))?.[1].trim().slice(0, 240) : undefined;
  return { title: chinese(props.locale) ? "技能说明已载入" : "Skill instructions loaded", summary: name, tone: "complete" as const, has_detail: true };
}
/** 通过宿主安全 Markdown 端口显示技能正文。 */
function detail(props: PowerInputDetailProps) { return create_element("div", { className: "p-3" }, props.render_text(instruction(props))); }
/** Skill 自有 Input 插槽。 */
export const SKILL_INPUT_RENDERER: PowerInputRenderer = { describe, detail };
