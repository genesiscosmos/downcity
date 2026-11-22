/** Task 定义、自动安排、执行受理、结果与人工验收的独立展示；查询不会改变业务状态。 */
import { task_activity_resource } from "./TaskActivityResource.js";
import { action_sentences, preparing_sentence } from "./TaskCopy.js";
import { activity_error_reason, with_activity_error } from "@downcity/city/power/react";
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "@downcity/city/power/react";
import { ActivityText, action_of, args_of, call_tone, chinese, data_of, error_of, preview, record, text } from "@/builtin/renderer/ActivityContent.js";


/** generate 返回工作区任务快照，其他动作返回平铺定义；只按当前 action 的契约读取。 */
function task_definition(props: PowerActivityProps): Record<string, unknown> {
  const task = record(data_of(props).task);
  return action_of(props) === "generate" ? record(task.definition) : task;
}

/** 仅本次操作明确返回的调度与启动失败，不把其他历史失败混入调用。 */
function operation_error(props: PowerActivityProps): string {
  const data = data_of(props);
  if (["list", "history", "run_detail", "inbox"].includes(action_of(props))) return error_of(props);
  const preparing = action_of(props) === "generate" ? record(task_definition(props).preparing) : {};
  const scheduler = record(data.scheduler);
  return error_of(props) || text(data.start_error) || text(data.schedule_error) || text(preparing.error)
    || text(preparing.start_error) || text(preparing.schedule_error) || (scheduler.reloaded === false ? text(scheduler.error) || (chinese(props.locale) ? "任务调度未生效" : "Task schedule was not applied") : "");
}

/** 本次准备结果中的问题仅作正文展示，不把已返回调用变成等待中的交互。 */
function preparation_questions(props: PowerActivityProps): string {
  if (action_of(props) !== "generate") return "";
  const values = record(task_definition(props).preparing).questions;
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string").slice(0, 12).map(value => value.slice(0, 4000)).join("\n\n") : "";
}

/** 定义与执行不是同一状态；run 的 accepted 只表示本次调用安排了执行。 */
function describe(props: PowerActivityProps): PowerActivityDescription {
  const action = action_of(props);
  const args = args_of(props);
  const data = data_of(props);
  const key = action === "work" ? text(args.command) : action;
  const zh = chinese(props.locale);
  let tone = call_tone(props);
  if (props.tool.state === "completed" && (data.success === false || action === "run" && data.accepted === false || operation_error(props))) tone = "failed";
  let sentence = (action_sentences[key] ?? action_sentences.unknown)![tone];
  const preparation = record(task_definition(props).preparing);
  if (tone === "complete" && action === "generate" && preparation.status === "needs_input") sentence = ["任务信息已整理", "Task information reviewed"];
  if (tone === "failed") sentence = action === "generate" && text(data.task_id)
    ? text(data.start_error) || text(preparation.start_error) ? ["任务已创建，尚未开始", "Task created, not started"]
      : text(data.schedule_error) || text(preparation.schedule_error) ? ["任务已创建，安排未生效", "Task created, but schedule not active"]
      : ["任务已创建，尚未准备好", "Task created, but not ready"] : (action_sentences[key] ?? action_sentences.unknown)!.failed;
  if (tone === "complete" && action === "list" && Array.isArray(data.tasks)) {
    const count = data.tasks.length;
    sentence = count ? [`${count} 项任务`, `${count} ${count === 1 ? "task" : "tasks"}`] : ["暂无任务", "No tasks"];
  }
  if (tone === "complete" && action === "history" && Array.isArray(data.runs)) {
    const count = data.runs.length;
    sentence = count ? [`${count} 次任务执行`, `${count} task ${count === 1 ? "run" : "runs"}`] : ["暂无执行记录", "No task runs"];
  }
  if (tone === "complete" && action === "inbox" && Array.isArray(data.tasks)) {
    const count = data.tasks.length;
    sentence = count ? [`${count} 项任务需要处理`, `${count} ${count === 1 ? "task needs" : "tasks need"} attention`] : ["没有待处理事项", "Nothing needs attention"];
  }
  if (tone === "waiting") sentence = (action_sentences[key] ?? action_sentences.unknown)!.waiting;
  if (props.tool.state === "input-streaming") sentence = preparing_sentence;
  const run = record(data.run);
  const body = action === "run_detail" ? text(run.output) || text(run.error_detail) : ["create", "update"].includes(action) ? text(args.body)
    : action === "generate" ? text(task_definition(props).body) : "";
  const scheduler = record(data.scheduler);
  const reason = text(data.start_error) || text(preparation.start_error) ? (zh ? "任务执行未能启动。" : "Task execution could not be started.")
    : text(data.schedule_error) || text(preparation.schedule_error) ? (zh ? "任务已创建，但安排未生效。" : "The task was created, but its schedule is not active.")
      : scheduler.reloaded === false ? (zh ? "任务安排未能刷新。" : "The task schedule could not be refreshed.") : undefined;
  const resource = task_activity_resource(props);
  return { error: tone === "failed" && reason ? { reason: activity_error_reason(props, reason) } : undefined, title: sentence[zh ? 0 : 1]!, tone, resource,
    summary: resource?.label || preview(task_definition(props).title) || preview(data.title) || (args.title !== data.task_id && !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(text(args.title)) ? preview(args.title) : undefined),
    has_detail: !["list", "history", "inbox"].includes(action) && Boolean(body.trim() || preparation_questions(props) || operation_error(props) || action === "run_detail" && ["running", "success", "failure"].includes(text(run.status))) };
}

/** 输出只读取业务正文；任务元数据、运行 JSON 和日志不作为用户详情。 */
function detail(props: PowerActivityProps) {
  const data = data_of(props);
  const action = action_of(props);
  const run = record(data.run);
  const body = action === "run_detail" ? text(run.output) : ["create", "update"].includes(action) ? text(args_of(props).body)
    : action === "generate" ? text(task_definition(props).body) : "";
  const stages: Readonly<Record<string, readonly [string, string]>> = {
    running: ["执行中", "Running"], success: ["执行完成", "Finished"], failure: ["执行失败", "Failed"],
  };
  const stage = action === "run_detail" ? stages[text(run.status)]?.[chinese(props.locale) ? 0 : 1] : undefined;
  const snapshot = stage ? `${chinese(props.locale) ? "查询时状态" : "Status when checked"}: ${stage}` : "";
  return <ActivityText render_text={props.render_text} body={[snapshot, body, preparation_questions(props)].filter(Boolean).join("\n\n")} />;
}
/** Task 自有 activity 插槽。 */
export const TASK_ACTIVITY_RENDERER: PowerActivityRenderer = with_activity_error({ describe, detail });
