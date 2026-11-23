/** Skill 说明与 MCP 回执遵循各自契约；外部工具未知结构不转为 JSON 详情。 */
import { action_sentences, preparing_sentence } from "./SkillCopy.js";
import { with_activity_error } from "@downcity/city/power/react";
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "@downcity/city/power/react";
import { action_of, args_of, call_tone, chinese, data_of, preview } from "@/builtin/renderer/ActivityContent.js";


/** MCP 成功不代表某个外部业务已完成；没有阅读协议时保持单行。 */
function describe(props: PowerActivityProps): PowerActivityDescription {
  const action = action_of(props);
  const data = data_of(props);
  const args = args_of(props);
  const tone = props.tool.state === "completed" && (data.success === false || data.isError === true) ? "failed" : call_tone(props);
  let sentence = (action_sentences[action] ?? action_sentences.unknown)![tone];
  if (tone === "complete" && ["list", "servers", "tools"].includes(action)) {
    const collection = action === "list" ? data.skills : action === "servers" ? data.servers : data.tools;
    if (Array.isArray(collection)) {
      const count = collection.length;
      sentence = action === "list" ? [`已列出 ${count} 个可用技能`, `Listed ${count} available ${count === 1 ? "skill" : "skills"}`]
        : action === "servers" ? [`已列出 ${count} 个已配置服务`, `Listed ${count} configured ${count === 1 ? "service" : "services"}`]
        : [`已列出 ${count} 个可用工具`, `Listed ${count} available ${count === 1 ? "tool" : "tools"}`];
    }
  }
  if (tone === "failed") sentence = (action_sentences[action] ?? action_sentences.unknown)!.failed;
  if (tone === "waiting") sentence = (action_sentences[action] ?? action_sentences.unknown)!.waiting;
  if (props.tool.state === "input-streaming") sentence = preparing_sentence;
  return { title: sentence[chinese(props.locale) ? 0 : 1]!, tone, summary: action === "call" ? preview(args.tool_name) : preview(args.name),
    has_detail: false };
}
/** Skill 自有插槽。 */
export const SKILL_ACTIVITY_RENDERER: PowerActivityRenderer = with_activity_error({ describe });
