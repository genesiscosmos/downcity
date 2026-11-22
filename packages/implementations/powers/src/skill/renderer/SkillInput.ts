/** Skill lookup 单行文件入口，严格解释 tool_media/context skill 的 name/id/path 来源头。 */
import type { PowerInputProps, PowerInputDescription, PowerInputRenderer } from "@downcity/city/power/react";
import { chinese } from "@/builtin/renderer/ActivityContent.js";

/** 严格匹配生产头；宿主按资源标识重新发现文件，不接受路径读取权限。 */
function describe(props: PowerInputProps): PowerInputDescription | null {
  if (props.input.kind !== "tool_media") return null;
  const part = props.input.content.find(item => item.type === "context" && item.tag === "skill");
  if (!part || part.type !== "context") return null;
  const header = /^name: ([^\r\n]+)\nid: ([^\r\n]+)\npath: ([^\r\n]+)\n\n/.exec(part.context.slice(0, 4_000));
  if (!header) return null;
  const [, name, skill_id, path] = header;
  if (!name?.trim() || !skill_id?.trim() || !path?.trim()) return null;
  return { title: chinese(props.locale) ? "已加载技能" : "Skill loaded", summary: name, tone: "complete", has_detail: false,
    file: { kind: "skill", skill_id, label: name, path } };
}
/** Skill 自有单行入口，无内联正文。 */
export const SKILL_INPUT_RENDERER: PowerInputRenderer = { describe };
