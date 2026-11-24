/** 共享详情正文的宿主属性；业务内容、可访问名称与外层滚动均由调用方持有。 */
import type { HTMLAttributes, ReactNode } from "react";

/** 详情只提供统一排版，不创建滚动容器或独立业务状态。 */
export interface DetailContentProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "className"> {
  /** 已由所属业务解释的正文、表单或状态内容；不会提前求值折叠内容。 */
  children: ReactNode;
  /** 宿主表面与位置样式；正文的留白、字号和内容间距由共享组件管理。 */
  class_name?: string;
}
