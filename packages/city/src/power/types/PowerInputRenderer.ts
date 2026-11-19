/**
 * 后台 Input 的独立只读展示协议。describe 可隐藏内部事件；detail 在展开时挂载。
 * 宿主提供安全正文和附件阅读端口，不注入执行网关，不改变 canonical 输入。
 */
import type { ComponentType, ReactNode } from "react";
import type { SessionAgentInputPart, SessionModelUserContent } from "@downcity/type";
import type { PowerActivityDescription } from "./PowerActivityRenderer.js";

/** 轻量投影只读取事件快照与当前语言。 */
export interface PowerInputProps {
  /** 完整 canonical 事件；嵌套内容同样只读。 */
  readonly input: Readonly<SessionAgentInputPart>;
  /** 当前界面语言；切换时重新投影，不重新执行业务。 */
  readonly locale: string;
}

/** 正文端口只在展开后注入，不授予新的资源访问权限。 */
export interface PowerInputDetailProps extends PowerInputProps {
  /** 通过宿主现有安全 Markdown 组件显示有界可读正文。 */
  readonly render_text: (text: string) => ReactNode;
  /** 通过宿主现有附件组件显示已持久化的文件。 */
  readonly render_file: (file: Extract<SessionModelUserContent, { type: "file" }>) => ReactNode;
}

/** 所属 Power 自己决定业务事件是否可见及其详情。 */
export interface PowerInputRenderer {
  /** 轻量纯函数；返回 null 表示该事件不占用户消息。 */
  readonly describe: (props: PowerInputProps) => PowerActivityDescription | null;
  /** 按需正文；收起即卸载，不能自动执行业务操作。 */
  readonly detail?: ComponentType<PowerInputDetailProps>;
}
