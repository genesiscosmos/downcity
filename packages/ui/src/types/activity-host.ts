/** 活动领域适配边界；共享 UI 不依赖 Desktop、Power 注册表或网络客户端。 */
import type { ComponentType, ReactNode } from "react";
import type { ActivityRowProps } from "./activity-row";
import type { AgentActivityPart } from "./chat-blocks";
import type { ActivityRowSummary } from "./activity-row";
import type { AgentActivityVisualKind } from "./activity";

/** 宿主对公共默认展示的最小覆盖。 */
export interface ActivityHost {
  /** 当前语言标识；传给宿主领域适配器，不影响传输。 */
  locale?: string;
  /** 已确认的 Power 名、标题与可选图标地址。 */
  powers?: ReadonlyMap<string, {
    /** Power 面向用户的标题。 */ title: string;
    /** 已授权的 Power 图标资源地址。 */ icon_url?: string;
  }>;
  /** 可选的状态边界组件；只能适配阅读状态，行结构继续使用共享 ActivityRow。 */
  row_component?: ComponentType<ActivityRowProps & {
    /** 当前消息内稳定的 Part 标识。 */ display_key: string;
    /** 独立的分组、工具、操作、推理或输入展开身份。 */ display_kind: "activity.group.expanded" | "activity.tool.expanded" | "activity.action.expanded" | "activity.reasoning.expanded" | "input.detail.expanded";
  }>;
  /** 推理详情的阅读字号，由宿主现有对话字号映射；省略时继承 Markdown Provider。 */
  reasoning_text_size?: import("../components/markdown/markdown_text_size").MarkdownViewTextSize;
  /** 是否为没有专用正文的内建文件工具展示输入和结果；默认开启。 */
  show_tool_details?: boolean;
  /** 领域摘要与懒详情；返回 undefined 使用公共 canonical 展示，null 表示隐藏。 */
  describe?(part: AgentActivityPart, group_summary: boolean): ActivityRowSummary | null | undefined;
  /** Power 或类型图标；返回 undefined 使用共享的类型图标。 */
  render_icon?(kind: AgentActivityVisualKind, power_name?: string): ReactNode;
  /** 可信资源入口；省略时只展示路径，不赋予浏览器本地文件权限。 */
  render_file?(path: string, label: string): ReactNode;
}
