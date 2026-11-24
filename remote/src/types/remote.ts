/** Remote 页面状态：City 与订阅由连接 hook 独占，组件只消费可见投影。 */
import type { AgentSessionSummary } from "@downcity/agent";
import type { RemoteCityAgentInfo } from "@downcity/city/browser";
import type { DowncityChatConnection } from "@downcity/ui";

/** 中英文界面语言。 */
export type Remote_locale = "en" | "zh";

/** 用户明确同意保存在当前浏览器中的连接；只由连接所有者读取。 */
export interface Remembered_connection {
  /** 已规范化的 City 根地址，不含查询参数或内嵌凭据。 */
  city_url: string;
  /** 用于恢复访问的私密凭据，不向视图或日志公开。 */
  token: string;
}

/** 一次连接与会话选择的用户可见状态。 */
export interface Remote_state {
  /** 通过发现请求确认可用的 City 地址；空值表示未连接。 */
  city_url: string;
  /** 当前凭据获准访问的 Agent 列表。 */
  agents: RemoteCityAgentInfo[];
  /** 当前选择的 Agent，允许没有可访问 Agent。 */
  agent_id?: string;
  /** 当前 Agent 的主聊天会话，按服务端活动时间排序。 */
  sessions: AgentSessionSummary[];
  /** 下一页会话的不透明游标，末页为空。 */
  next_cursor?: string;
  /** 当前正在读取的会话身份。 */
  session_id?: string;
  /** 原 Session 的协议分类；子会话导航保留其 work 身份。 */
  session_type?: string;
  /** 不在主聊天侧栏内的工作会话仍保留自己的真实标题。 */
  session_title?: string;
  /** 当前原会话及同 Agent 后代的共享状态面板数据与动作。 */
  status_panel?: import("@downcity/ui").DowncityChatPanelProps["status_panel"];
  /** 当前已完成 ready 订阅与历史合并的 UI 连接。 */
  connection?: DowncityChatConnection;
  /** 连接或切换会话时禁用重复操作。 */
  busy: boolean;
  /** 会话列表翻页中的独立状态。 */
  loading_more: boolean;
  /** 当前浏览器已保存连接的公开地址；不包含凭据。 */
  saved_city_url?: string;
  /** 浏览器存储失败提示，不阻止当前连接。 */
  storage_notice?: string;
  /** 最近一次连接或导航失败；不包含凭据。 */
  error?: string;
}
