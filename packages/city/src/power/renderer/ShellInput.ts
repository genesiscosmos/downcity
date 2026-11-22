/** Shell 后台终态只读取 ShellCompletionBridge 的确切信封，不补造命令。 */
import { createElement as create_element } from "react";
import type { PowerInputProps, PowerInputDetailProps, PowerInputRenderer } from "../types/PowerInputRenderer.js";
import { input_envelope } from "./Input.js";
import { is_chinese, text_value } from "./Activity.js";

/** 非零退出和丢失监管都不能显示成功。 */
function describe(props: PowerInputProps) {
  const data = input_envelope(props.input, "shell_result");
  if (!Object.keys(data).length) return null;
  const zh = is_chinese(props.locale);
  const failed = typeof data.exit_code === "number" && data.exit_code !== 0 || Boolean(data.interruption_reason) || data.status === "failed" || data.status === "killed";
  return { title: failed ? (zh ? "命令执行失败" : "Command failed") : (zh ? "命令已结束" : "Command finished"),
    tone: failed ? "failed" as const : "complete" as const,
    has_detail: Boolean(text_value(data.output_preview).trim() || text_value(data.interruption_reason).trim() || typeof data.exit_code === "number" && data.exit_code !== 0) };
}

/** 有界终端正文，间距由 Input 宿主负责；React 文本节点保证输出不会作为 HTML 执行。 */
function detail(props: PowerInputDetailProps) {
  const data = input_envelope(props.input, "shell_result");
  const output = text_value(data.output_preview).slice(0, 24_000).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const reason = text_value(data.interruption_reason).slice(0, 4_000);
  return create_element("div", { className: "space-y-3 text-xs" },
    output ? create_element("pre", { className: "max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono" }, output) : null,
    reason ? create_element("p", { className: "text-destructive" }, reason) : null,
    typeof data.exit_code === "number" && data.exit_code !== 0 ? create_element("p", { className: "text-destructive" }, is_chinese(props.locale) ? `退出码：${data.exit_code}` : `Exit code: ${data.exit_code}`) : null);
}

/** 与 Shell activity 分离的后台结果插槽。 */
export const SHELL_INPUT_RENDERER: PowerInputRenderer = { describe, detail };
