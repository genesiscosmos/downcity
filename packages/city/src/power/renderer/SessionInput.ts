/** Session 生产的执行结果与通用可读输入；内部维护和模型媒体不占消息行。 */
import { createElement as create_element } from "react";
import type { PowerInputProps, PowerInputDetailProps, PowerInputRenderer } from "../types/PowerInputRenderer.js";
import { input_envelope } from "./Input.js";
import { is_chinese, text_value } from "./Activity.js";

/** 隐藏仅供模型执行的已知生产事件；不影响 canonical 输入、顺序与记账。 */
const internal_kinds = new Set(["maintenance", "incomplete_response_recovery", "max_steps_finalization", "memory", "tool_media"]);

/** 未知结构化 context 不解释；只有明确 text/file 可成为用户正文。 */
function readable_content(props: PowerInputProps) {
  return props.input.content.slice(0, 24).filter(item => item.type === "file" || (item.type === "text" && item.text.trim()));
}

/** 工作会话的单次执行结果来自 SessionDelegations，不把结果回传说成会话已关闭。 */
function describe(props: PowerInputProps) {
  const { input, locale } = props;
  const zh = is_chinese(locale);
  if (internal_kinds.has(input.kind)) return null;
  if (input.kind === "delegation_result") {
    const data = input_envelope(input, "delegation_result");
    const state = text_value(data.state);
    const title = state === "failed" ? (zh ? "工作会话执行失败" : "Work session failed")
      : state === "stopped" ? (zh ? "工作会话已停止" : "Work session stopped")
      : (zh ? "收到工作会话结果" : "Work session result received");
    return { title, tone: state === "failed" ? "failed" as const : "complete" as const,
      has_detail: Boolean(text_value(data.text).trim() || text_value(data.error).trim()) };
  }
  if (input.kind === "power_result" || input.kind === "shell_result") return null;
  if (!readable_content(props).length) return null;
  return { title: input.kind === "task" ? (zh ? "收到任务指令" : "Task instructions received") : (zh ? "收到补充内容" : "Additional content received"),
    tone: "complete" as const, has_detail: true };
}

/** 只展开真正交付正文；外壳由 Input 宿主负责间距，不显示附给 Agent 的处理指令。 */
function detail(props: PowerInputDetailProps) {
  if (props.input.kind === "delegation_result") {
    const data = input_envelope(props.input, "delegation_result");
    const text = text_value(data.text).slice(0, 48_000);
    const error = text_value(data.error).slice(0, 4_000);
    return create_element("div", { className: "space-y-3" },
      text ? props.render_text(text) : null,
      error ? create_element("p", { className: "text-destructive whitespace-pre-wrap" }, error) : null);
  }
  return create_element("div", { className: "space-y-3" }, ...readable_content(props).map((item, index) =>
    create_element("div", { key: index }, item.type === "file" ? props.render_file(item) : item.type === "text" ? props.render_text(item.text.slice(0, 48_000)) : null)));
}

/** 独立于 activity 生命周期的 Session 输入展示。 */
export const SESSION_INPUT_RENDERER: PowerInputRenderer = { describe, detail };
