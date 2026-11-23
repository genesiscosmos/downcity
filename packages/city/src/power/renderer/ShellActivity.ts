/**
 * Shell 活动：命令与有界输出按需展开。stdin 永不作为标题、摘要或正文；
 * session_send 的已知回显会被移除，私密占位输入对应的输出整体隐藏。
 * 此模块只消费调用快照，不读取实时 PTY，也不执行任何命令。
 */
import { action_sentences, preparing_sentence } from "./ShellCopy.js";
import { with_activity_error } from "./ActivityError.js";
import { createElement as create_element } from "react";
import type { PowerActivityProps, PowerActivityRenderer, PowerActivityDescription } from "../types/PowerActivityRenderer.js";
import { action_id, activity_tone, failure_text, input_args, is_chinese, output_data, short_text, text_value } from "./Activity.js";


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

/** 仅同步调用失败可改变终态；后台进程运行和等待不会延长本次调用。 */
function shell_tone(props: PowerActivityProps): PowerActivityDescription["tone"] {
  const tone = activity_tone(props);
  if (props.tool.state !== "completed" || tone === "failed") return tone;
  const data = output_data(props);
  const command_action = ["exec", "session_start"].includes(action_id(props));
  if (data.success === false || ["denied", "rejected"].includes(text_value(data.approval_status))) return "failed";
  if (command_action && (exit_code(props) !== undefined && exit_code(props) !== 0 || ["failed", "killed"].includes(text_value(data.status)))) return "failed";
  return "complete";
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
  if (props.tool.state === "input-streaming") return { title: preparing_sentence[is_chinese(props.locale) ? 0 : 1], tone: "running", has_detail: false };
  const action = action_id(props);
  const args = input_args(props);
  const data = output_data(props);
  const chinese = is_chinese(props.locale);
  const tone = shell_tone(props);
  let title = (action_sentences[action] ?? action_sentences.unknown)![tone];
  const command_action = action === "exec" || action === "session_start";
  const code = exit_code(props);
  if (tone === "complete" && action === "exec" && ["running", "starting"].includes(text_value(data.status))) title = ["已启动命令", "Started command"];
  if (tone === "complete" && action === "session_read" && data.output === "") title = ["已读取终端输出", "Read terminal output"];
  if (tone === "complete" && action === "session_list" && Array.isArray(data.sessions)) {
    const count = data.sessions.length;
    title = [`已列出 ${count} 个终端会话`, `Listed ${count} terminal ${count === 1 ? "session" : "sessions"}`];
  }
  if (tone === "failed" && command_action && data.status === "killed") title = action === "session_start"
    ? ["未能启动终端会话", "Could not start terminal session"] : ["未能执行命令", "Could not execute command"];
  if (tone === "failed" && ["denied", "rejected"].includes(text_value(data.approval_status))) title = action === "exec"
    ? ["未能执行命令", "Could not execute command"] : (action_sentences[action] ?? action_sentences.unknown)!.failed;
  return {
    title: title[chinese ? 0 : 1],
    error: tone === "failed" && command_action && code !== undefined && code !== 0 ? { reason: chinese ? `进程以退出码 ${code} 结束。` : `The process exited with code ${code}.` } : undefined,
    summary: command_action ? short_text(args.cmd) || short_text(data.cmd) : undefined,
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
  const pre_class = "max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs";
  return create_element("div", { className: "space-y-3 p-3 text-xs leading-relaxed" },
    command ? create_element("pre", { className: pre_class }, `$ ${command.slice(0, 12_000)}`) : null,
    output ? create_element("div", { className: "space-y-1" },
      create_element("pre", { className: pre_class }, output),
      text_value(data.output).length > 24_000 ? create_element("p", { className: "text-muted-foreground" }, chinese ? "输出已截断" : "Output truncated") : null) : null);
}

/** Shell 自有 activity 插槽。 */
export const SHELL_ACTIVITY_RENDERER: PowerActivityRenderer = with_activity_error({ describe: describe_shell, detail: shell_detail });
