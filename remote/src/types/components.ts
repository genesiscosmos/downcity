/** Remote 组件契约：组件接收语言和连接控制器，不拥有 transport。 */
import type { ReactNode } from "react";
import type { use_remote } from "../lib/use_remote";
import type { Remote_locale } from "./remote";
import type { DowncityChatContentPart, DowncityChatPanelProps } from "@downcity/ui";

/** 连接表单最小宿主能力。 */
export interface Connect_page_props {
  /** 当前界面语言。 */ locale: Remote_locale;
  /** 连接期间锁定表单。 */ busy: boolean;
  /** 连接失败的可读说明。 */ error?: string;
  /** 当前浏览器已保存连接的公开地址，凭据始终由宿主持有。 */ saved_city_url?: string;
  /** 存储受限时按需显示，不阻止当前连接。 */ storage_notice?: string;
  /** 宿主持有连接生命周期，仅用户明确选择 remember 时保存访问凭据。 */ on_connect: (city_url: string, token: string, remember: boolean) => Promise<void>;
  /** 使用浏览器保存的凭据重试，不要求视图接触凭据。 */ on_retry: () => Promise<void>;
  /** 清除当前浏览器保存，已连接会话可继续。 */ on_forget: () => void;
}

/** 已连接工作区需要的页面能力。 */
export interface Remote_workspace_props {
  /** hook 独占连接与异步请求，视图仅调用其公开操作。 */ controller: ReturnType<typeof use_remote>;
  /** 当前界面语言。 */ locale: Remote_locale;
  /** Appearance and guide actions folded into the single conversation header. */ header_actions?: ReactNode;
  /** Mark a development-only synthetic host; never represents a real City. */ showcase?: boolean;
}

/** 私密问答表单的显示和提交边界。 */
export interface Private_interaction_props {
  /** 交互所属原 Session，避免切换后读取其他会话。 */ session_id: string;
  /** UI SDK 的交互投影，仅包含公开问题与状态。 */ part: DowncityChatContentPart;
  /** 从 City 读取原始交互，不在页面保存另一份权威状态。 */ read_interaction: ReturnType<typeof use_remote>["read_interaction"];
  /** 经 runtime 交给专用私密 API 提交答案。 */ respond: DowncityChatPanelProps["on_respond_interaction"];
  /** 表单加载与失败说明的界面语言。 */ locale: Remote_locale;
}
