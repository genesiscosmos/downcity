/** Remote 组件契约：组件接收语言和连接控制器，不拥有 transport。 */
import type { use_remote } from "../lib/use_remote";
import type { Remote_locale } from "./remote";
import type { DowncityChatContentPart, DowncityChatPanelProps } from "@downcity/ui";

/** 连接表单最小宿主能力。 */
export interface Connect_page_props {
  /** 当前界面语言。 */ locale: Remote_locale;
  /** 连接期间锁定表单。 */ busy: boolean;
  /** 连接失败的可读说明。 */ error?: string;
  /** 宿主持有客户端与凭据生命周期。 */ on_connect: (city_url: string, token: string) => Promise<void>;
}

/** 已连接工作区需要的页面能力。 */
export interface Remote_workspace_props {
  /** hook 独占连接与异步请求，视图仅调用其公开操作。 */ controller: ReturnType<typeof use_remote>;
  /** 当前界面语言。 */ locale: Remote_locale;
}

/** 私密问答表单的显示和提交边界。 */
export interface Private_interaction_props {
  /** 交互所属原 Session，避免切换后读取其他会话。 */ session_id: string;
  /** UI SDK 的交互投影，仅包含公开问题与状态。 */ part: DowncityChatContentPart;
  /** 从 City 读取原始交互，不在页面保存另一份权威状态。 */ read_interaction: ReturnType<typeof use_remote>["read_interaction"];
  /** 经 runtime 交给专用私密 API 提交答案。 */ respond: DowncityChatPanelProps["on_respond_interaction"];
  /** 表单加载与失败说明的界面语言。 */ locale: Remote_locale;
}
