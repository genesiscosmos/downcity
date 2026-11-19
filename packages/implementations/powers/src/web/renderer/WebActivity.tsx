/** Web 动作逐项解释搜索、文档和浏览器回执；不显示浏览器快照、refs 或操作参数。 */
import type { PowerActivityDescription, PowerActivityProps, PowerActivityRenderer } from "@downcity/city/power/react";
import { ActivityText, action_of, args_of, call_tone, chinese, data_of, error_of, preview, text } from "@/builtin/renderer/ActivityContent.js";

/** 完整已完成句子。 */
const completed: Readonly<Record<string, readonly [string, string]>> = {
  "": ["已读取 Web 动作", "Web actions read"], status: ["已查看网页服务状态", "Web service status read"],
  search: ["网页搜索已结束", "Web search finished"], open: ["已读取网页正文", "Web page read"],
  browser_create_session: ["浏览器页面已打开", "Browser page opened"], browser_observe: ["已查看浏览器页面", "Browser page observed"],
  browser_act: ["浏览器操作已执行", "Browser action performed"], browser_extract: ["已提取页面内容", "Page content extracted"],
  browser_semantic_act: ["页面操作已执行", "Page action performed"], browser_semantic_extract: ["已提取页面正文", "Page text extracted"],
  browser_list_sessions: ["已列出浏览器页面", "Browser pages listed"], browser_close_session: ["浏览器页面已关闭", "Browser page closed"],
};
/** 每个浏览器动作使用自己的完整进行时句子。 */
const running: Readonly<Record<string, readonly [string, string]>> = {
  status: ["正在检查网页服务", "Checking Web service"], search: ["正在搜索网页", "Searching the web"], open: ["正在读取网页", "Reading web page"],
  browser_create_session: ["正在打开浏览器页面", "Opening browser page"], browser_observe: ["正在查看浏览器页面", "Observing browser page"],
  browser_act: ["正在执行浏览器操作", "Performing browser action"], browser_extract: ["正在提取页面内容", "Extracting page content"],
  browser_semantic_act: ["正在执行页面操作", "Performing page action"], browser_semantic_extract: ["正在提取页面正文", "Extracting page text"],
  browser_list_sessions: ["正在查找浏览器页面", "Finding browser pages"], browser_close_session: ["正在关闭浏览器页面", "Closing browser page"],
};
/** 只有生产契约承诺的正文类型可以展开。 */
const content_actions = new Set(["open", "browser_extract", "browser_semantic_extract"]);

/** 业务失败由 Web 自己读取，搜索和列表始终单行。 */
function describe(props: PowerActivityProps): PowerActivityDescription {
  const action = action_of(props);
  const args = args_of(props);
  const data = data_of(props);
  const zh = chinese(props.locale);
  const tone = data.success === false ? "failed" : call_tone(props);
  let sentence = (tone === "complete" ? completed[action] : running[action]) ?? ["网页操作已返回", "Web operation returned"];
  if (tone === "failed") sentence = ["网页操作失败", "Web operation failed"];
  if (tone === "waiting") sentence = ["网页操作等待确认", "Web operation awaiting confirmation"];
  if (props.tool.state === "input-streaming") sentence = ["正在准备网页操作", "Preparing Web operation"];
  const can_expand = !["search", "browser_list_sessions", "status", ""].includes(action);
  return { title: sentence[zh ? 0 : 1]!, tone, summary: action === "search" ? preview(args.query) : preview(data.title) || preview(args.url) || preview(data.url),
    has_detail: can_expand && Boolean(content_actions.has(action) && (action === "browser_semantic_extract" ? text(data.text) : text(data.content)).trim() || error_of(props)) };
}
/** 浏览器 observe/act 内部 observation 不进入可读详情。 */
function detail(props: PowerActivityProps) { return <ActivityText render_text={props.render_text} body={content_actions.has(action_of(props)) ? (action_of(props) === "browser_semantic_extract" ? text(data_of(props).text) : text(data_of(props).content)) : ""} error={error_of(props)} />; }
/** Web 自有展示。 */
export const WEB_ACTIVITY_RENDERER: PowerActivityRenderer = { describe, detail };
