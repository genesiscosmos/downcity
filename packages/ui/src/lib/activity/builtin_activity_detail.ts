/** 文件、搜索与提问的确定性展示适配器；只读取 canonical 结果，不请求新数据。 */
import type { SessionAgentToolPart } from "@downcity/type";
import type { AgentActivityPresentation, AgentToolIdentity } from "../../types/activity";
import type { ActivityQuestion, ActivityReadableDetail, ActivityText } from "../../types/activity-readable";
import { activity_item_limit, activity_text_limit, bounded_text, redact_private, object_value, read_input, text_value } from "./activity_detail_shared.ts";

/** 本批覆盖的闭集，不让 Power 进入非 Power 适配器。 */
const builtin_names = new Set(["read", "write", "edit", "grep", "find", "ask_user"]);
/** 用于折叠行的有限长度目标；正文保留完整目标。 */
function target_of(part: SessionAgentToolPart): string {
  const fields = part.tool_name === "grep" ? ["query", "pattern"] : part.tool_name === "find" ? ["pattern", "glob"] : part.tool_name === "ask_user" ? ["title"] : ["file_path", "path"];
  return read_input(part, fields);
}
/** 业务失败和生命周期失败均不宣称成功。 */
export function builtin_failed(part: SessionAgentToolPart): boolean {
  return part.state === "failed" || part.state === "completed" && (object_value(part.output)?.success === false || part.interactions?.some(item => item.status === "failed") === true);
}
/** 本批内置工具才使用请求中的等待状态。 */
export function builtin_waiting(part: SessionAgentToolPart): boolean {
  return builtin_names.has(part.tool_name) && part.state !== "completed" && part.state !== "failed" && (part.state === "waiting-user" || part.interactions?.some(item => item.status === "pending") === true);
}
/** 本地文案片段。 */
function label(name: string, values?: Record<string, string>): ActivityText { return { key: `activity.detail.${name}`, values }; }

/** 优先使用对应请求的响应；没有 interaction 的历史记录仅按输出顺序回显。 */
function question_rows(part: SessionAgentToolPart): { /** 请求顺序的只读问答。 */ rows: ActivityQuestion[]; /** 存在内容或条目省略。 */ limited: boolean } {
  let text_budget = activity_text_limit;
  let limited = false;
  const limit_text = (text: string) => {
    const preview = bounded_text(text.slice(0, Math.max(0, text_budget)));
    limited ||= preview.length < text.length;
    text_budget -= preview.length;
    return redact_private(preview);
  };
  const interactions = part.interactions?.filter(item => item.request.type === "question").slice(0, activity_item_limit) ?? [];
  const requests = interactions.length ? interactions : [null];
  const output = object_value(part.output);
  const rows = requests.flatMap(interaction => {
    const payload = object_value(interaction?.request.payload ?? part.input);
    const questions = Array.isArray(payload?.questions) ? payload.questions : [];
    limited ||= questions.length > activity_item_limit;
    const response = object_value(interaction?.response?.payload ?? output);
    const answers = Array.isArray(response?.answers) ? response.answers.map(object_value) : [];
    return questions.slice(0, activity_item_limit).flatMap((entry, index) => {
      const question = object_value(entry);
      if (!question) return [];
      const answer = interaction ? answers.find(item => item?.question_id === question.question_id) : answers[index];
      const value = answer?.value;
      const provided = typeof value === "string" ? value.length > 0 : Array.isArray(value) && value.length > 0;
      let result: ActivityText = label(interaction?.status === "pending" || builtin_waiting(part) ? "awaiting_answer" : "no_answer");
      if (provided) {
        if (question.type === "secret") result = label("private_provided");
        else {
          const options = Array.isArray(question.options) ? question.options.map(object_value) : [];
          const values = Array.isArray(value) ? value : [value];
          limited ||= values.length > activity_item_limit;
          result = { text: values.slice(0, activity_item_limit).map(item => text_value(options.find(option => option?.value === item)?.label) || text_value(item)).join(", ") };
        }
      }
      const question_text = limit_text(text_value(question.question));
      if (result.text) result.text = limit_text(result.text);
      return [{ question: question_text, answer: result }];
    });
  });
  return { rows: rows.slice(0, activity_item_limit), limited: limited || rows.length > activity_item_limit };
}

/** 内建工具仅为问答构造详情；文件与搜索活动只显示状态行。 */
function read_question_detail(part: SessionAgentToolPart): ActivityReadableDetail {
  const detail: ActivityReadableDetail = { type: "readable", target: "", facts: [] };
  const error = part.error || text_value(object_value(part.output)?.message);
  if (builtin_failed(part) && error) detail.facts.push({ text: error });
  const questions = question_rows(part);
  detail.body = { type: "questions", questions: questions.rows };
  if (questions.limited) detail.facts.push(label("preview_limited"));
  return detail;
}

/** 在稳定身份判定之后覆盖非 Power 工具；其他活动保持已有规则。 */
export function resolve_builtin_activity(part: SessionAgentToolPart, identity: AgentToolIdentity, base: AgentActivityPresentation): AgentActivityPresentation {
  if (identity.kind !== "builtin" || !builtin_names.has(part.tool_name)) return base;
  const output = object_value(part.output);
  const failed = builtin_failed(part);
  const waiting = builtin_waiting(part);
  const success = part.state === "completed" && output?.success === true && !failed;
  const answered = part.tool_name === "ask_user" && (output?.status === "resolved" || (part.interactions?.length && part.interactions.every(item => item.status === "resolved")));
  let state_key = failed ? `activity.${base.visual_kind}.failed` : waiting ? "activity.detail.waiting" : base.state_key;
  let state_values: Record<string, string> | undefined;
  if (!failed && !waiting) {
    if (answered) state_key = "activity.detail.answered";
    else if (part.state === "input-streaming" && part.tool_name === "write") state_key = "activity.detail.generating";
    else if (part.state === "completed" && !success) state_key = "activity.detail.result_unavailable";
    else if (success && (part.tool_name === "grep" || part.tool_name === "find")) {
      const items = part.tool_name === "grep" ? output.matches : output.files;
      if (Array.isArray(items)) {
        state_key = `activity.detail.${part.tool_name === "grep" ? "matches_returned" : "files_returned"}${output.truncated === true ? "_partial" : ""}`;
        state_values = { count: String(items.length) };
      }
    }
  }
  return { ...base, file_path: ["read", "write", "edit"].includes(part.tool_name) && !base.input_streaming ? text_value(output?.file_path) || target_of(part) || undefined : undefined, state_key, state_values, tone: failed ? "failed" : waiting ? "waiting" : base.tone, summary: target_of(part).slice(0, 240), diff_stat: success && !failed ? base.diff_stat : null, error: "", read_detail: part.tool_name === "ask_user" ? () => read_question_detail(part) : undefined };
}
