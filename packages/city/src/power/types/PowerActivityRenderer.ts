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

/** 本次调用的可读失败说明；原文仍由宿主从 canonical output 安全读取。 */
export interface PowerActivityError {
  /** 简短、已本地化的用户说明，不包含原始 JSON、堆栈或内部结构。 */
  readonly reason: string;
}

/** 折叠行的轻量语义；资源身份由宿主导航，不包含 JSX、URL 或预先格式化的详情。 */
export interface PowerActivityDescription {
  /** 本次调用的动作或终态标题；完成后描述该调用已完成的动作，不显示后台对象的持续状态。 */
  readonly title: string;
  /** 可选的目标预览；只读明确的业务字段，不扫描完整输出。 */
  readonly summary?: string;
  /** 可选的单个主对象；只在可靠结果确认对象身份后提供，组摘要及无宿主时回退纯文本。 */
  readonly resource?: import("./PowerActivityResource.js").PowerActivityResource;
  /** 本次调用的展示状态；必须跟随 tool.state。正常返回为 complete，后台 running/queued 不得改变它；完成时可依据本次明确业务失败使用 failed。 */
  readonly tone: "running" | "waiting" | "complete" | "failed";
  /** 本次调用是否有正常业务详情；正常展开需注册 detail，错误详情由宿主独立提供。 */
  readonly has_detail: boolean;
  /** 明确声明本次调用失败（包括同步业务失败），不指查询读到的目标失败。宿主优先显示统一错误详情，即使 has_detail 为 false。 */
  readonly error?: PowerActivityError;
}

/** 一套 Power 自有的活动语义与按需渲染的详情正文。 */
export interface PowerActivityRenderer {
  /** 同步纯函数，不使用 Hook、请求网络、执行业务动作或计算完整详情。 */
  readonly describe: (props: PowerActivityProps) => PowerActivityDescription;
  /** 只提供详情正文的 React 组件；允许 Hook，但不能自动执行业务动作。 */
  readonly detail?: ComponentType<PowerActivityProps>;
}
