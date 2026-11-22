/** Web 动作逐项解释搜索、文档和浏览器回执；不显示浏览器快照、refs 或操作参数。 */
import { action_sentences, preparing_sentence } from "./WebCopy.js";
import { with_activity_error } from "@downcity/city/power/react";
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "@downcity/city/power/react";
import { ActivityText, action_of, args_of, call_tone, chinese, data_of, error_of, preview, text } from "@/builtin/renderer/ActivityContent.js";

/** 只有生产契约承诺的正文类型可以展开。 */
const content_actions = new Set(["open", "browser_extract", "browser_semantic_extract"]);

/** 业务失败由 Web 自己读取，搜索和列表始终单行。 */
function describe(props: PowerActivityProps): PowerActivityDescription {
  const action = action_of(props);
  const args = args_of(props);
  const data = data_of(props);
  const zh = chinese(props.locale);
  const tone = props.tool.state === "completed" && data.success === false ? "failed" : call_tone(props);
  let sentence = (action_sentences[action] ?? action_sentences.unknown)![tone];
  if (tone === "complete" && action === "search" && Array.isArray(data.items)) {
    const count = data.items.length;
    sentence = count ? [`找到 ${count} 条结果`, `${count} ${count === 1 ? "result" : "results"} found`] : ["没有找到相关网页", "No matching pages"];
  }
  if (tone === "complete" && action === "browser_list_sessions" && Array.isArray(data.sessions)) {
    const count = data.sessions.length;
    sentence = count ? [`${count} 个已打开页面`, `${count} open ${count === 1 ? "page" : "pages"}`] : ["暂无已打开页面", "No open pages"];
  }
  if (tone === "complete" && content_actions.has(action) && typeof data.content === "string" && !data.content.trim()) sentence = ["没有读取到内容", "No content found"];
  if (tone === "failed") sentence = (action_sentences[action] ?? action_sentences.unknown)!.failed;
  if (tone === "waiting") sentence = (action_sentences[action] ?? action_sentences.unknown)!.waiting;
  if (props.tool.state === "input-streaming") sentence = preparing_sentence;
  const can_expand = !["search", "browser_list_sessions", "status", ""].includes(action);
  return { title: sentence[zh ? 0 : 1]!, tone, summary: action === "search" ? preview(args.query) : preview(data.title) || preview(args.url) || preview(data.url),
    has_detail: can_expand && Boolean(content_actions.has(action) && text(data.content).trim() || error_of(props)) };
}
/** 浏览器 observe/act 内部 observation 不进入可读详情。 */
function detail(props: PowerActivityProps) { return <ActivityText render_text={props.render_text} body={content_actions.has(action_of(props)) ? text(data_of(props).content) : ""} />; }
/** Web 自有展示。 */
export const WEB_ACTIVITY_RENDERER: PowerActivityRenderer = with_activity_error({ describe, detail });
