/** Session Action 的本地可读投影；按确切业务类别和已知回执翻译，未知原文不猜测。 */
import type { SessionAgentActionPart } from "@downcity/type";
import type { AgentActivityPresentation, AgentActionVisualKind } from "../../types/activity";
import type { ActivityText } from "../../types/activity-readable";
import { bounded_text } from "./activity_detail_shared.ts";

/** canonical 生产者当前使用的 Action 类别。 */
const action_kinds: Readonly<Record<string, AgentActionVisualKind>> = { "history-fork": "fork", "context-compaction": "compaction", command: "command" };
/** 已由折叠行动作表达的固定描述，展开时无需再重复。 */
const redundant_descriptions = new Set([
  "Older stable parts are being folded into the context summary.",
  "Older stable parts were folded into the context summary.",
  "There are no older stable parts available for compaction.",
]);

/** 已知动作以 Agent 视角的本地化谓宾句作标题；对象名称和结果事实留在摘要与详情。 */
export function resolve_session_action(part: SessionAgentActionPart): AgentActivityPresentation {
  const visual_kind = action_kinds[part.action_type] ?? "generic";
  const known = visual_kind !== "generic";
  const description = part.description?.trim() ?? "";
  const state_key = known ? `activity.detail.action.${visual_kind}.${part.state}` : `activity.action.${part.state}`;
  const nothing_to_compact = part.action_type === "context-compaction" && part.title === "No session context to compact" && part.state === "completed";
  const config_updated = part.action_type === "command" && part.state === "completed" && part.title === "Session configuration updated";
  let result_key = nothing_to_compact ? "activity.detail.nothing_to_compact" : config_updated ? "activity.detail.config_updated" : state_key;
  if (config_updated && /^model: [^;]+$/.test(description)) result_key = "activity.detail.model_switched";
  if (config_updated && /^security\.approval_mode: [^;]+$/.test(description)) result_key = "activity.detail.approval_changed";
  const facts: ActivityText[] = [];
  let text = description;
  if (part.action_type === "context-compaction" && part.state !== "failed" && redundant_descriptions.has(description)) text = "";
  // fork 描述来自明确生产者格式，正文只展示复制消息的数量。
  const fork_result = part.action_type === "history-fork" && part.state === "completed" ? /^Copied (\d+) messages from session .+\.$/.exec(description) : null;
  if (fork_result) { facts.push({ key: "activity.detail.forked_messages", values: { count: fork_result[1] } }); text = ""; }
  if (config_updated && description) {
    const changes = description.split("; ").map(item => /^(model|workspace|security\.approval_mode): (.+)$/.exec(item));
    if (changes.every(item => item !== null)) {
      for (const change of changes) {
        if (!change) continue;
        facts.push(change[1] === "model" && change[2] !== "configured"
          ? { key: "activity.detail.model_selected", values: { model: change[2] } }
          : { key: `activity.detail.${change[1] === "model" ? "model_updated" : change[1] === "workspace" ? "workspace_updated" : "approval_updated"}` });
      }
      text = "";
    }
  }
  if (bounded_text(text).length < text.length) facts.push({ key: "activity.detail.preview_limited" });
  return {
    visual_kind, state_key: result_key, tone: part.state === "failed" ? "failed" : part.state === "completed" ? "complete" : "running", diff_stat: null,
    summary: known ? (part.action_type === "command" && !config_updated ? part.title.trim().slice(0, 160) : "") : (part.title.trim() || part.action_type).slice(0, 160),
    read_detail: text || facts.length ? () => ({ type: "readable", target: "", facts,
      ...(text ? { body: { type: "text", text: bounded_text(text) } as const } : {}),
    }) : undefined,
    error: "", input_streaming: false,
  };
}

/** 推理摘要仅认独立标题行；普通段落内的加粗词不充当标题，代码块不参与摘要。 */
export function summarize_reasoning(text: string): string {
  let title = "";
  let last_line = "";
  let fence = "";
  for (const raw_line of text.split("\n")) {
    const line = raw_line.trim();
    const marker = /^(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (fence[0] === marker[1][0] && marker[1].length >= fence.length && !marker[2].trim()) fence = "";
      continue;
    }
    if (!line || fence) continue;
    last_line = line;
    const heading = /^(?:#{1,6}\s+(.+?)\s*#*|\*\*([^*]+)\*\*)$/.exec(line);
    if (heading) title = heading[1] || heading[2];
  }
  const plain = (title || last_line).replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, "$1").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  const chars = Array.from(plain);
  return chars.length > 120 ? `${chars.slice(0, 119).join("")}…` : plain;
}
