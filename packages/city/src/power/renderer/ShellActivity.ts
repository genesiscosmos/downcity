/**
 * Shell 活动：命令与有界输出按需展开。stdin 永不作为标题、摘要或正文；
 * session_send 的已知回显会被移除，私密占位输入对应的输出整体隐藏。
 * 此模块只消费调用快照，不读取实时 PTY，也不执行任何命令。
 */
import { createElement as create_element } from "react";
import type { PowerActivityProps, PowerActivityRenderer, PowerActivityDescription } from "../types/PowerActivityRenderer.js";
import { action_id, activity_tone, failure_text, input_args, is_chinese, output_data, preparing_description, short_text, text_value } from "./Activity.js";

/** Shell 自有中英文动作名称。 */
const action_sentences: Readonly<Record<string, Record<PowerActivityDescription["tone"], readonly [string, string]>>> = {
  "exec": {
    running: ["正在执行命令", "Running command"],
    waiting: ["命令等待确认", "Command awaiting confirmation"],
    complete: ["命令已结束", "Command finished"],
    failed: ["命令执行失败", "Command failed"],
  },
  "session_start": {
    running: ["正在启动终端", "Starting terminal"],
    waiting: ["终端启动等待确认", "Terminal start awaiting confirmation"],
    complete: ["终端已启动", "Terminal started"],
    failed: ["终端启动失败", "Terminal start failed"],
  },
  "session_send": {
    running: ["正在发送终端输入", "Sending terminal input"],
    waiting: ["终端输入等待确认", "Terminal input awaiting confirmation"],
    complete: ["终端输入已发送", "Terminal input sent"],
    failed: ["终端输入发送失败", "Terminal input failed"],
  },
  "session_read": {
    running: ["正在读取终端输出", "Reading terminal output"],
    waiting: ["读取终端输出等待确认", "Terminal read awaiting confirmation"],
    complete: ["已读取终端输出", "Terminal output read"],
    failed: ["终端输出读取失败", "Terminal read failed"],
  },
  "session_list": {
    running: ["正在查找终端会话", "Finding terminal sessions"],
    waiting: ["终端查询等待确认", "Terminal query awaiting confirmation"],
    complete: ["已列出终端会话", "Terminal sessions listed"],
    failed: ["终端查询失败", "Terminal query failed"],
  },
  "session_stop": {
    running: ["正在停止终端", "Stopping terminal"],
    waiting: ["终端停止等待确认", "Terminal stop awaiting confirmation"],
    complete: ["终端已停止", "Terminal stopped"],
    failed: ["终端停止失败", "Terminal stop failed"],
  },
  "": {
    running: ["正在读取 Shell 动作", "Reading Shell actions"],
    waiting: ["Shell 操作等待确认", "Shell operation awaiting confirmation"],
    complete: ["已读取 Shell 动作", "Shell actions read"],
    failed: ["Shell 操作失败", "Shell operation failed"],
  },
};

/** 允许有专用正文的动作；列表与停止动作保持单行。 */
const detail_actions = new Set(["exec", "session_start", "session_send", "session_read"]);

/** 原始输入可能经私密替换；无法确定回显可公开时隐藏 send 输出。 */
function private_send(props: PowerActivityProps): boolean {
  if (action_id(props) !== "session_send") return false;
  const input = text_value(input_args(props).input);
  return !input || input.length > 4096 || /\$\{secrets\.|\[redacted\]|\[private\]|<redacted>|\*{3,}/i.test(input);
}

/** 只接受实际数值退出码；null 表示进程尚未结束。 */
function exit_code(props: PowerActivityProps): number | undefined {
  const value = output_data(props).exit_code;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Shell 业务失败优先于普通进程状态；已完成调用的 PTY 仍可保持运行。 */
function shell_tone(props: PowerActivityProps): PowerActivityDescription["tone"] {
  const tone = activity_tone(props);
  if (props.tool.state === "failed" || props.tool.state === "waiting-user") return tone;
  if (tone === "failed" || (exit_code(props) !== undefined && exit_code(props) !== 0)) return "failed";
  const data = output_data(props);
  if (data.success === false) return "failed";
  if (["failed", "killed"].includes(text_value(data.status))) return "failed";
  if (["waiting", "waiting_for_user", "pending_approval"].includes(text_value(data.status))) return "waiting";
  if (["pending", "waiting", "requested"].includes(text_value(data.approval_status))) return "waiting";
  if (["denied", "rejected"].includes(text_value(data.approval_status))) return "failed";
  if (tone === "waiting") return tone;
  return ["running", "starting"].includes(text_value(data.status)) ? "running" : tone;
}

/** 清除终端控制序列与已知 send 回显；私密占位输入无法与实际值比对时隐藏全部原文。 */
function safe_terminal_text(props: PowerActivityProps, text: string): string {
  if (private_send(props)) return "";
  // 多取一个最大输入长度的余量，先清除完整回显再截断，避免截断处漏出半段输入。
  let output = text.slice(0, 28_096).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  if (action_id(props) === "session_send") {
    const input = text_value(input_args(props).input).trim();
    // 逐行处理 PTY 的 CRLF 回显；同时移除不带换行的整段已知输入。
    for (const fragment of [input, ...input.split(/\r?\n/)].filter(Boolean)) {
      output = output.split(fragment).join(is_chinese(props.locale) ? "[输入已隐藏]" : "[input hidden]");
    }
  }
  return output.slice(0, 24_000);
}

/** 轻量描述只选择命令或列表数量，绝不读取 stdin 作为摘要。 */
function describe_shell(props: PowerActivityProps): PowerActivityDescription {
  const preparing = preparing_description(props, "Shell");
  if (preparing) return preparing;
  const action = action_id(props);
  const args = input_args(props);
  const data = output_data(props);
  const chinese = is_chinese(props.locale);
  const tone = shell_tone(props);
  const title = action_sentences[action]?.[tone] ?? action_sentences[""]![tone];
  const command_action = action === "exec" || action === "session_start";
  return {
    title: title[chinese ? 0 : 1],
    summary: command_action ? short_text(args.cmd) || short_text(data.cmd) : action === "session_list" && Array.isArray(data.sessions)
      ? (chinese ? `${data.sessions.length} 个终端会话` : `${data.sessions.length} terminal ${data.sessions.length === 1 ? "session" : "sessions"}`) : undefined,
    tone,
    has_detail: detail_actions.has(action) && Boolean(
      (command_action && (text_value(args.cmd) || text_value(data.cmd)))
      || (!private_send(props) && text_value(data.output).length)
      || (exit_code(props) !== undefined && exit_code(props) !== 0) || failure_text(props)
    ),
  };
}

/** 专用正文组件：React 只在宿主展开 activity 时挂载。 */
function shell_detail(props: PowerActivityProps) {
  const args = input_args(props);
  const data = output_data(props);
  const chinese = is_chinese(props.locale);
  const action = action_id(props);
  const command = action === "exec" || action === "session_start" ? text_value(args.cmd) || text_value(data.cmd) : "";
  const output = safe_terminal_text(props, text_value(data.output));
  const code = exit_code(props);
  const failure = private_send(props) && failure_text(props)
    ? (chinese ? "终端输入失败" : "Terminal input failed") : safe_terminal_text(props, failure_text(props));
  const pre_class = "max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs";
  return create_element("div", { className: "space-y-3 p-3 text-xs leading-relaxed" },
    command ? create_element("pre", { className: pre_class }, `$ ${command.slice(0, 12_000)}`) : null,
    output ? create_element("div", { className: "space-y-1" },
      create_element("pre", { className: pre_class }, output),
      text_value(data.output).length > 24_000 ? create_element("p", { className: "text-muted-foreground" }, chinese ? "输出已截断" : "Output truncated") : null) : null,
    code !== undefined && code !== 0 ? create_element("p", { className: "text-destructive" }, `${chinese ? "退出码" : "Exit code"}: ${code}`) : null,
    failure ? create_element("p", { className: "whitespace-pre-wrap break-words text-destructive" }, failure.slice(0, 4000)) : null);
}

/** Shell 自有 activity 插槽。 */
export const SHELL_ACTIVITY_RENDERER: PowerActivityRenderer = { describe: describe_shell, detail: shell_detail };
