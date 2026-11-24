/** 共享详情完整布局的宿主属性；业务提供内容和控件，面板持有纵向滚动。 */
import type { HTMLAttributes, ReactNode } from "react";

/** 详情只提供统一排版，不创建滚动容器或独立业务状态。 */
export interface DetailContentProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "className"> {
  /** 已由所属业务解释的正文、表单或状态内容；不会提前求值折叠内容。 */
  children: ReactNode;
  /** 可选的紧凑标题；没有标题和其他头部内容时不创建头部。 */
  heading?: string;
  /** 标题 DOM 标识，供详情区域及外部表单引用同一可访问名称。 */
  heading_id?: string;
  /** 可选来源、时间与状态；共享布局负责换行、对齐和弱化文字层级。 */
  metadata?: ReactNode;
  /** 标题行右侧的可选控件，例如关闭；不会与标题和正文创建重复留白。 */
  header_actions?: ReactNode;
  /** 可选的详情操作，例如打开来源；共享布局负责操作区间距和换行。 */
  actions?: ReactNode;
  /** 宿主表面与位置样式；标题、正文的留白、字号和间距由共享组件管理。 */
  class_name?: string;
}
