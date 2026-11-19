/**
 * Power 活动展示契约。宿主提供已获准展示的 canonical 快照，Power 只描述本次操作。
 * describe 是轻量同步纯函数；detail 由 React 在展开时挂载，收起即卸载。
 * 嵌套快照同样按只读约定使用；本插槽不授予执行权限或额外的私密数据访问能力。
 */
import type { ComponentType, ReactNode } from "react";
import type { SessionAgentToolPart } from "@downcity/type";

/** 描述与详情共享的本次调用快照。 */
export interface PowerActivityProps {
  /** 已按宿主现有访问限制处理的工具记录；不得修改其嵌套数据。 */
  readonly tool: Readonly<SessionAgentToolPart>;
  /** 当前界面语言，如 zh-CN 或 en；由 Power 选择自己的文案。 */
  readonly locale: string;
  /** 详情可复用宿主安全 Markdown；轻量 describe 不调用此端口。 */
  readonly render_text?: (text: string) => ReactNode;
  /** 详情按宿主现有权限预览业务结果文件；不读取额外资源。 */
  readonly render_file?: import("./PowerInputRenderer.js").PowerInputDetailProps["render_file"];
}

/** 折叠行使用的纯文本语义，不包含链接或预先格式化的完整详情。 */
export interface PowerActivityDescription {
  /** 完整动作或结果标题；宿主统一限制显示长度。 */
  readonly title: string;
  /** 可选的目标预览；只读明确的业务字段，不扫描完整输出。 */
  readonly summary?: string;
  /** 本次调用的展示状态；宿主保留 canonical 失败、等待的优先级。 */
  readonly tone: "running" | "waiting" | "complete" | "failed";
  /** 本次调用是否有有意义的详情；还需注册 detail 组件才能展开。 */
  readonly has_detail: boolean;
}

/** 一套 Power 自有的活动语义与按需渲染的详情正文。 */
export interface PowerActivityRenderer {
  /** 同步纯函数，不使用 Hook、请求网络、执行业务动作或计算完整详情。 */
  readonly describe: (props: PowerActivityProps) => PowerActivityDescription;
  /** 只提供详情正文的 React 组件；允许 Hook，但不能自动执行业务动作。 */
  readonly detail?: ComponentType<PowerActivityProps>;
}
