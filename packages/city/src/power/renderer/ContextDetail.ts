/**
 * Context 的按需详情：只读取当前调用的公开快照，展示发现接口与脚本执行事实。
 * 使用既有活动详情排版；源码、结果及列表独立限长，不请求更多数据或执行任何动作。
 */
import { createElement as create_element } from "react";
import type { PowerActivityProps } from "../types/PowerActivityRenderer.js";
import { action_id, failure_text, input_args, is_chinese, output_data, record_items, record_value, text_value } from "./Activity.js";

/** 成员字段过长时保留明确的省略标记。 */
function clipped_text(value: unknown, limit: number): string {
  const text = text_value(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 有界 JSON 预览，限制深度、成员数和文本，保留 null、false、0 等有效返回值。 */
function json_preview(value: unknown): string {
  let remaining_nodes = 200;
  function project(item: unknown, depth: number): unknown {
    if (--remaining_nodes < 0) return "…";
    if (typeof item === "string") return item.length > 12_000 ? `${item.slice(0, 12_000)}…` : item;
    if (item === null || typeof item !== "object") return item;
    if (depth >= 6) return "…";
    if (Array.isArray(item)) {
      const items = item.slice(0, 40).map(child => project(child, depth + 1));
      return item.length > 40 ? [...items, "…"] : items;
    }
    const keys = Object.keys(item);
    const result = Object.fromEntries(keys.slice(0, 40).map(key => [key, project(record_value(item)[key], depth + 1)]));
    return keys.length > 40 ? { ...result, "…": "…" } : result;
  }
  return JSON.stringify(project(value, 0), null, 2) ?? "";
}

/** 活动详情已有的标题与等宽正文；截断明确标记，长行允许换行。 */
function text_section(title: string, body: string, props: PowerActivityProps, limit = 12_000) {
  if (!body) return null;
  return create_element("section", { className: "space-y-2" },
    create_element("p", { className: "font-medium" }, title),
    create_element("pre", { className: "whitespace-pre-wrap break-words font-mono" }, body.slice(0, limit)),
    body.length > limit ? create_element("p", { className: "text-muted-foreground" }, is_chinese(props.locale) ? "仅显示部分内容" : "Showing partial content") : null);
}

/** help 展示本次定位条件、接口声明与下一页游标，不把 SDK 内部字段当作用户信息。 */
function help_detail(props: PowerActivityProps) {
  const args = input_args(props);
  const data = output_data(props);
  const chinese = is_chinese(props.locale);
  const target = text_value(args.symbol) || text_value(args.query) || (chinese ? "公开接口索引" : "Public interface index");
  const query = `${target}${typeof args.cursor === "number" ? ` · cursor: ${args.cursor}` : ""}`;
  const interfaces = record_items(data.symbols).map(member => [
    clipped_text(member.symbol, 400),
    clipped_text(member.description, 1_000),
    `input: ${clipped_text(member.input_type, 4_000)}`,
    `output: ${clipped_text(member.output_type, 4_000)}`,
  ].filter(Boolean).join("\n")).join("\n\n");
  const objects = Array.isArray(data.objects) ? data.objects.slice(0, 40).map(item => clipped_text(item, 200)).filter(Boolean).join(", ") : "";
  return create_element("div", { className: "space-y-3" },
    text_section(chinese ? "查询目标" : "Query target", query, props, 1_000),
    objects ? text_section(chinese ? "可用对象" : "Available objects", objects, props, 4_000) : null,
    interfaces ? text_section(chinese ? "返回接口" : "Returned interfaces", interfaces, props, 24_000)
      : Array.isArray(data.symbols) ? create_element("p", { className: "text-muted-foreground" }, chinese ? "未找到匹配接口" : "No matching interfaces") : null,
    Array.isArray(data.symbols) && data.symbols.length > 12 || Array.isArray(data.objects) && data.objects.length > 40
      ? create_element("p", { className: "text-muted-foreground" }, chinese ? "仅显示部分内容" : "Showing partial content") : null,
    typeof data.next_cursor === "number" ? create_element("p", { className: "text-muted-foreground" }, `${chinese ? "下一页游标" : "Next cursor"}: ${data.next_cursor}`) : null,
    text_section(chinese ? "错误" : "Error", failure_text(props), props, 4_000));
}

/** 执行详情保持脚本、结果和调用回执分开；回执不推断回滚或最终效果。 */
function execute_detail(props: PowerActivityProps) {
  const args = input_args(props);
  const data = output_data(props);
  const chinese = is_chinese(props.locale);
  const runtime_error = record_value(data.error);
  const location = record_value(runtime_error.location);
  const error = [text_value(runtime_error.code), text_value(runtime_error.message),
    typeof location.line === "number" ? `${chinese ? "源码位置" : "Source location"}: ${location.line}${typeof location.column === "number" ? `:${location.column}` : ""}` : "",
  ].filter(Boolean).join("\n") || failure_text(props);
  const calls = Array.isArray(data.calls) ? data.calls.slice(0, 40) : [];
  const receipts = calls.map(item => {
    const call = record_value(item);
    return { symbol: call.symbol, status: call.status, receipt_id: call.receipt_id, ...(call.error ? { error: call.error } : {}) };
  });
  const logs = Array.isArray(data.logs) ? data.logs.slice(0, 40).map(item => clipped_text(item, 12_000)).join("\n") : "";
  return create_element("div", { className: "space-y-3" },
    text_section(chinese ? "脚本" : "Script", text_value(args.code), props, 16_000),
    text_value(data.status) ? create_element("p", null, `${chinese ? "执行状态" : "Execution status"}: ${text_value(data.status)}`) : null,
    text_value(data.execution_id) ? create_element("p", { className: "text-muted-foreground break-words" }, `${chinese ? "执行 ID" : "Execution ID"}: ${clipped_text(data.execution_id, 200)}`) : null,
    Object.hasOwn(data, "value") ? text_section(chinese ? "返回值" : "Return value", json_preview(data.value), props) : null,
    text_section(chinese ? "日志" : "Logs", logs, props),
    Array.isArray(data.logs) && data.logs.length > 40 ? create_element("p", { className: "text-muted-foreground" }, chinese ? "仅显示前 40 条日志" : "Showing the first 40 log entries") : null,
    receipts.length ? text_section(chinese ? "调用回执" : "Call receipts", json_preview(receipts), props) : null,
    Array.isArray(data.calls) && data.calls.length > 40 ? create_element("p", { className: "text-muted-foreground" }, chinese ? "仅显示前 40 条回执" : "Showing the first 40 receipts") : null,
    text_section(chinese ? "错误" : "Error", error, props, 4_000),
    data.state_reset === true ? create_element("p", { className: "text-muted-foreground" }, chinese ? "执行状态已重置" : "Execution state was reset") : null,
    text_section(chinese ? "完整结果引用" : "Full result reference", text_value(data.result_ref), props, 1_000));
}

/** 省略 action 的发现结果保留动作名称、用途、访问方式与返回说明。 */
function actions_detail(props: PowerActivityProps) {
  const data = output_data(props);
  const body = record_items(data.actions).map(action => [
    `${clipped_text(action.action, 200)}${text_value(action.access) ? ` (${clipped_text(action.access, 20)})` : ""}`,
    clipped_text(action.description, 1_000),
    clipped_text(action.returns, 2_000),
  ].filter(Boolean).join("\n")).join("\n\n");
  return create_element("div", { className: "space-y-3" },
    text_section(is_chinese(props.locale) ? "可用动作" : "Available actions", body, props, 24_000),
    Array.isArray(data.actions) && data.actions.length > 12 ? create_element("p", { className: "text-muted-foreground" }, is_chinese(props.locale) ? "仅显示前 12 个动作" : "Showing the first 12 actions") : null);
}

/** 根据明确动作选择详情，其他事实查询保留精简展示与路径拒绝原因。 */
export function context_detail(props: PowerActivityProps) {
  const action = action_id(props);
  if (action === "help") return help_detail(props);
  if (action === "execute") return execute_detail(props);
  if (action === "") return actions_detail(props);
  const data = output_data(props);
  const reason = action === "sandbox.explain_path" && data.allowed === false ? text_value(data.reason) : "";
  return text_section(is_chinese(props.locale) ? "访问原因" : "Access reason", reason, props, 4_000);
}
