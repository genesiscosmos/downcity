/** Task 定义、自动安排、执行受理、结果与人工验收的独立展示；查询不会改变业务状态。 */
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "@downcity/city/power/react";
import { ActivityText, action_of, args_of, call_tone, chinese, data_of, error_of, preview, record, text } from "@/builtin/renderer/ActivityContent.js";

/** 完整动作句子；work 子命令精确匹配。 */
const completed: Readonly<Record<string, readonly [string, string]>> = {
  "": ["已读取 Task 动作", "Task actions read"], list: ["已列出任务", "Tasks listed"],
  create: ["任务定义已创建", "Task definition created"], update: ["任务定义已更新", "Task definition updated"],
  generate: ["任务安排已保存", "Task plan saved"], run: ["任务执行请求已返回", "Task execution request returned"],
  status: ["任务调度状态已更新", "Task schedule updated"], enable: ["任务调度已启用", "Task scheduling enabled"],
  disable: ["任务调度已停用", "Task scheduling disabled"], delete: ["任务定义已删除", "Task definition deleted"],
  reload: ["任务调度已重新加载", "Task scheduler reloaded"], history: ["已列出执行历史", "Execution history listed"],
  run_detail: ["已读取任务执行结果", "Task execution result read"], inbox: ["已查看待处理任务", "Pending tasks read"],
  work: ["任务处理请求已返回", "Task workflow request returned"],
  organize: ["任务已整理", "Task organized"], start: ["任务进度已设为进行中", "Task progress set to in progress"],
  complete: ["任务已标记完成", "Task marked complete"], cancel: ["任务已取消", "Task cancelled"],
  reopen: ["任务已重新打开", "Task reopened"], pause: ["任务调度已暂停", "Task scheduling paused"],
  resume: ["任务调度已恢复", "Task scheduling resumed"], resolve: ["待处理事项已解决", "Pending item resolved"],
  accept: ["任务结果已验收", "Task result accepted"], revise: ["任务结果已退回修改", "Task result returned for revision"],
  skip: ["本次任务已跳过", "Task occurrence skipped"],
};
/** 执行中的句子与完成句子独立维护。 */
const running: Readonly<Record<string, readonly [string, string]>> = {
  list: ["正在查找任务", "Finding tasks"], create: ["正在创建任务定义", "Creating task definition"],
  update: ["正在更新任务定义", "Updating task definition"], generate: ["正在生成任务安排", "Preparing task plan"],
  run: ["正在提交任务执行", "Submitting task execution"], status: ["正在更新任务调度", "Updating task schedule"],
  enable: ["正在启用任务调度", "Enabling task scheduling"], disable: ["正在停用任务调度", "Disabling task scheduling"],
  delete: ["正在删除任务定义", "Deleting task definition"], reload: ["正在加载任务调度", "Reloading task scheduler"],
  history: ["正在读取执行历史", "Reading execution history"], run_detail: ["正在读取任务结果", "Reading task result"],
  inbox: ["正在查看待处理任务", "Reading pending tasks"], organize: ["正在整理任务", "Organizing task"],
  start: ["正在更新任务进度", "Updating task progress"], complete: ["正在标记任务完成", "Marking task complete"],
  cancel: ["正在取消任务", "Cancelling task"], reopen: ["正在重新打开任务", "Reopening task"],
  pause: ["正在暂停任务调度", "Pausing task scheduling"], resume: ["正在恢复任务调度", "Resuming task scheduling"],
  resolve: ["正在解决待处理事项", "Resolving pending item"], accept: ["正在验收任务结果", "Accepting task result"],
  revise: ["正在退回任务修改", "Returning task for revision"], skip: ["正在跳过本次任务", "Skipping task occurrence"],
};

/** 仅本次操作明确返回的调度与启动失败，不把其他历史失败混入调用。 */
function operation_error(props: PowerActivityProps): string {
  const data = data_of(props);
  const preparing = record(record(data.task).preparing);
  const scheduler = record(data.scheduler);
  return error_of(props) || text(data.start_error) || text(data.schedule_error) || text(preparing.error)
    || text(preparing.start_error) || text(preparing.schedule_error) || (scheduler.reloaded === false ? text(scheduler.error) || (chinese(props.locale) ? "任务调度未生效" : "Task schedule was not applied") : "");
}

/** 定义与执行不是同一状态；run 的 accepted 只表示入队。 */
function describe(props: PowerActivityProps): PowerActivityDescription {
  const action = action_of(props);
  const args = args_of(props);
  const data = data_of(props);
  const key = action === "work" ? text(args.command) : action;
  const zh = chinese(props.locale);
  let tone = call_tone(props);
  if (data.success === false || action === "run" && data.accepted === false || operation_error(props)) tone = "failed";
  let sentence = (tone === "complete" ? completed[key] : running[key]) ?? (tone === "complete" ? ["任务操作已返回", "Task operation returned"] : ["正在处理任务操作", "Processing task operation"]);
  if (tone === "complete" && action === "run" && data.accepted === true) sentence = ["任务执行已入队", "Task execution queued"];
  const preparation = record(record(data.task).preparing);
  if (tone === "complete" && action === "generate") {
    if (preparation.status === "needs_input") { tone = "waiting"; sentence = ["任务安排需要补充信息", "Task plan needs more information"]; }
    else if (["queued", "analyzing", "delegating"].includes(text(preparation.status))) { tone = "running"; sentence = ["任务安排正在生成", "Task plan is being prepared"]; }
  }
  if (tone === "complete" && action === "run_detail") {
    const status = text(record(data.run).status);
    if (status === "success") sentence = ["任务执行已结束", "Task execution finished"];
    if (status === "failure") { tone = "failed"; sentence = ["任务执行失败", "Task execution failed"]; }
    if (status === "running") { tone = "running"; sentence = ["任务正在执行", "Task execution in progress"]; }
  }
  if (tone === "failed" && action !== "run_detail") sentence = action === "generate" && text(record(data.task).task_id)
    ? ["任务已保存，安排未完成", "Task saved; planning is incomplete"] : ["任务操作失败", "Task operation failed"];
  if (tone === "waiting" && preparation.status !== "needs_input") sentence = ["任务操作等待确认", "Task operation awaiting confirmation"];
  if (props.tool.state === "input-streaming") sentence = ["正在准备任务操作", "Preparing task operation"];
  const run = record(data.run);
  const body = action === "run_detail" ? text(run.output) || text(run.error_detail) : ["create", "update"].includes(action) ? text(args.body)
    : action === "generate" ? text(record(data.task).body) : "";
  return { title: sentence[zh ? 0 : 1]!, tone, summary: preview(record(data.task).title) || preview(args.title),
    has_detail: !["list", "history", "inbox"].includes(action) && Boolean(body.trim() || operation_error(props)) };
}

/** 输出只读取业务正文；任务元数据、运行 JSON 和日志不作为用户详情。 */
function detail(props: PowerActivityProps) {
  const data = data_of(props);
  const action = action_of(props);
  const run = record(data.run);
  const body = action === "run_detail" ? text(run.output) : ["create", "update"].includes(action) ? text(args_of(props).body)
    : action === "generate" ? text(record(data.task).body) : "";
  return <ActivityText render_text={props.render_text} body={body} error={operation_error(props) || (action === "run_detail" ? text(run.error_detail) : "")} />;
}
/** Task 自有 activity 插槽。 */
export const TASK_ACTIVITY_RENDERER: PowerActivityRenderer = { describe, detail };
