/** Memory 的调用、处理任务与提交结果分别投影；queued/running 永不冒充已保存。 */
import { memory_activity_resource } from "./MemoryActivityResource.js";
import { action_sentences, memory_completion_sentence, preparing_sentence } from "./MemoryCopy.js";
import { with_activity_error } from "@downcity/city/power/react";
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "@downcity/city/power/react";
import { ActivityText, action_of, args_of, call_tone, chinese, data_of, error_of, items, preview, record, text } from "@/builtin/renderer/ActivityContent.js";


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

/** 只确认同步回执中的已生效结果；后台阶段不延长或改变调用终态。 */
function describe(props: PowerActivityProps): PowerActivityDescription {
  const action = action_of(props);
  const args = args_of(props);
  const data = data_of(props);
  const zh = chinese(props.locale);
  const tone = call_tone(props);
  const job = action === "job_detail" ? record(data.job) : data;
  const status = text(job.status);
  let sentence = (action_sentences[action] ?? action_sentences.unknown)![tone];
  if (tone === "complete" && ["remember", "digest", "revise", "optimize"].includes(action)) {
    if (status === "succeeded" || action === "remember" && ["saved", "created"].includes(status)) sentence = memory_completion_sentence(action);
    else if (status === "skipped") sentence = ["已检查记忆更新", "Checked memory updates"];
  }
  if (tone === "complete" && ["search", "list", "jobs"].includes(action) && Array.isArray(data.items)) {
    const count = data.items.length;
    const empty_page = data.total !== 0 && (typeof data.total === "number" && data.total > 0 || typeof args.offset === "number" && args.offset > 0);
    if (action === "search") sentence = count ? [`已找到 ${count} 条相关记忆`, `Found ${count} matching ${count === 1 ? "memory" : "memories"}`] : ["未找到相关记忆", "Found no matching memories"];
    else if (action === "list") sentence = count ? [`已列出 ${count} 条记忆`, `Listed ${count} ${count === 1 ? "memory" : "memories"}`]
      : empty_page ? ["已列出本页 0 条记忆", "Listed 0 memories on this page"] : ["已列出 0 条记忆", "Listed 0 memories"];
    else sentence = count ? [`已列出 ${count} 条整理记录`, `Listed ${count} memory activity ${count === 1 ? "record" : "records"}`]
      : empty_page ? ["已列出本页 0 条整理记录", "Listed 0 memory activity records on this page"] : ["已列出 0 条整理记录", "Listed 0 memory activity records"];
  }
  if (tone === "complete" && (action === "forget" && data.forgotten === false || action === "read" && data.memory === null)) sentence = ["未找到这条记忆", "Found no matching memory"];
  if (tone === "complete" && action === "forget" && typeof data.forgotten !== "boolean") sentence = ["已处理忘记请求", "Processed memory removal request"];
  if (tone === "waiting") sentence = (action_sentences[action] ?? action_sentences.unknown)!.waiting;
  if (props.tool.state === "input-streaming") sentence = preparing_sentence;
  const detail = action === "read" ? Boolean(text(record(data.memory).content).trim()) : action === "job_detail"
    ? items(data.changes).some(change => text(record(change.before).content).trim() || text(record(change.after).content).trim()) : false;
  const resource = memory_activity_resource(props);
  return { title: sentence[zh ? 0 : 1], tone, resource,
    summary: resource?.label || (action === "search" ? preview(args.query) : preview(args.topic) || preview(args.title) || preview(record(data.memory).topic)),
    has_detail: !["search", "list", "jobs", "status"].includes(action) && (detail || Boolean(error_of(props)) || ["job_status", "job_detail"].includes(action) && Boolean(status)) };
}

/** 失败的暂存变更保留其实际 job 状态，不把详情当作保存确认。 */
function detail(props: PowerActivityProps) {
  const data = data_of(props);
  const action = action_of(props);
  const job = action === "job_detail" ? record(data.job) : data;
  const status = text(job.status);
  // 目标阶段仅是查询当时的结果，不反向改变该查询的生命周期。
  const stages: Readonly<Record<string, readonly [string, string]>> = {
    queued: ["等待整理", "Pending"], running: ["整理中", "Processing"], processing: ["整理中", "Processing"],
    committing: ["更新中", "Updating"], retry_wait: ["等待重试", "Awaiting retry"],
    succeeded: ["已完成", "Finished"], failed: ["未完成", "Failed"], skipped: ["无需更新", "No updates needed"],
  };
  const stage = ["job_status", "job_detail"].includes(action) ? stages[status]?.[chinese(props.locale) ? 0 : 1] : undefined;
  const snapshot = stage ? `${chinese(props.locale) ? "查询时状态" : "Status when checked"}: ${stage}` : "";
  return <ActivityText render_text={props.render_text} body={[snapshot, memory_body(props)].filter(Boolean).join("\n\n")} />;
}
/** Memory 自有活动，不依赖宿主分支。 */
export const MEMORY_ACTIVITY_RENDERER: PowerActivityRenderer = with_activity_error({ describe, detail });
