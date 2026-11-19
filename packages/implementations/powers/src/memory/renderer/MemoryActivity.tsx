/** Memory 的调用、处理任务与提交结果分别投影；queued/running 永不冒充已保存。 */
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "@downcity/city/power/react";
import { ActivityText, action_of, args_of, call_tone, chinese, data_of, error_of, items, preview, record, text } from "@/builtin/renderer/ActivityContent.js";

/** 每个动作的完整句子，数组依次为中文和英文。 */
const completed_sentences: Readonly<Record<string, readonly [string, string]>> = {
  "": ["已读取 Memory 动作", "Memory actions read"], status: ["已查看记忆服务状态", "Memory service status read"],
  search: ["已检索记忆", "Memory search finished"], read: ["已读取记忆", "Memory read"], list: ["已列出记忆", "Memories listed"],
  remember: ["记忆保存请求已提交", "Memory storage requested"], digest: ["会话记忆提取已提交", "Session memory extraction requested"],
  revise: ["记忆修订请求已提交", "Memory revision requested"], forget: ["记忆已删除", "Memory deleted"],
  optimize: ["核心记忆整理已提交", "Profile consolidation requested"], jobs: ["已列出记忆处理任务", "Memory jobs listed"],
  job_status: ["已查看记忆处理状态", "Memory job status read"], job_detail: ["已读取记忆变更详情", "Memory changes read"],
  retry: ["记忆处理重试已提交", "Memory processing retry requested"],
};
/** 执行中的完整业务句子，不通过动作名加前缀生成。 */
const running_sentences: Readonly<Record<string, readonly [string, string]>> = {
  status: ["正在查看记忆服务", "Checking memory service"], search: ["正在检索记忆", "Searching memories"],
  read: ["正在读取记忆", "Reading memory"], list: ["正在列出记忆", "Listing memories"],
  remember: ["正在提交记忆保存请求", "Requesting memory storage"], digest: ["正在提交会话记忆提取", "Requesting memory extraction"],
  revise: ["正在提交记忆修订", "Requesting memory revision"], forget: ["正在删除记忆", "Deleting memory"],
  optimize: ["正在提交核心记忆整理", "Requesting profile consolidation"], jobs: ["正在查找记忆处理任务", "Finding memory jobs"],
  job_status: ["正在查看记忆处理状态", "Checking memory job status"], job_detail: ["正在读取记忆变更", "Reading memory changes"],
  retry: ["正在提交记忆处理重试", "Requesting memory processing retry"],
};

/** job_detail 返回固定的变化快照，不重新读取当前记忆。 */
function memory_body(props: PowerActivityProps): string {
  const action = action_of(props);
  const data = data_of(props);
  if (action === "read") return text(record(data.memory).content);
  if (action !== "job_detail") return "";
  const zh = chinese(props.locale);
  return items(data.changes).map(change => {
    const before = text(record(change.before).content).slice(0, 12_000);
    const after = text(record(change.after).content).slice(0, 12_000);
    if (!before && !after) return "";
    return [preview(change.topic), before ? `### ${zh ? "处理前" : "Before processing"}\n${before}` : "", after ? `### ${zh ? "处理后" : "After processing"}\n${after}` : ""].filter(Boolean).join("\n\n");
  }).filter(Boolean).join("\n\n");
}

/** 业务提交成功以 created/succeeded 为准；skipped 没有变更，failed 不显示已保存。 */
function describe(props: PowerActivityProps): PowerActivityDescription {
  const action = action_of(props);
  const args = args_of(props);
  const data = data_of(props);
  const zh = chinese(props.locale);
  let tone = call_tone(props);
  const job = action === "job_detail" ? record(data.job) : data;
  const status = text(job.status);
  const processing_action = ["remember", "digest", "revise", "optimize", "retry", "job_status", "job_detail"].includes(action);
  let sentence: readonly [string, string] = tone === "complete"
    ? completed_sentences[action] ?? ["记忆操作已返回", "Memory operation returned"]
    : running_sentences[action] ?? ["正在读取 Memory 动作", "Reading Memory actions"];
  if (tone === "complete" && processing_action) {
    if (status === "created" || status === "succeeded") sentence = ["记忆变更已保存", "Memory changes saved"];
    else if (status === "retry_wait") { tone = "running"; sentence = ["记忆处理等待重试", "Memory processing awaiting retry"]; }
    else if (status === "queued") { sentence = ["记忆处理已排队", "Memory processing queued"]; }
    else if (["running", "processing", "committing"].includes(status)) { tone = "running"; sentence = ["记忆正在处理中", "Memory processing in progress"]; }
    else if (status === "skipped") sentence = ["记忆处理结束，没有变更", "Memory processing finished without changes"];
    else if (status === "failed") { tone = "failed"; sentence = ["记忆处理失败", "Memory processing failed"]; }
  }
  if (tone === "failed") sentence = ["记忆操作失败", "Memory operation failed"];
  if (tone === "waiting") sentence = ["记忆操作等待确认", "Memory operation awaiting confirmation"];
  if (props.tool.state === "input-streaming") sentence = ["正在准备记忆操作", "Preparing memory operation"];
  const detail = action === "read" ? Boolean(text(record(data.memory).content).trim()) : action === "job_detail"
    ? items(data.changes).some(change => text(record(change.before).content).trim() || text(record(change.after).content).trim()) : false;
  return { title: sentence[zh ? 0 : 1], tone,
    summary: action === "search" ? preview(args.query) : preview(args.title) || preview(record(data.memory).topic),
    has_detail: !["search", "list", "jobs", "status"].includes(action) && (detail || Boolean(error_of(props) || status === "failed" && text(job.detail))) };
}

/** 失败的暂存变更保留其实际 job 状态，不把详情当作保存确认。 */
function detail(props: PowerActivityProps) {
  const data = data_of(props);
  const job = action_of(props) === "job_detail" ? record(data.job) : data;
  return <ActivityText render_text={props.render_text} body={memory_body(props)} error={error_of(props) || (job.status === "failed" ? text(job.detail) : "")} />;
}
/** Memory 自有活动，不依赖宿主分支。 */
export const MEMORY_ACTIVITY_RENDERER: PowerActivityRenderer = { describe, detail };
