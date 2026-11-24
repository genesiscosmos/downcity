/** ActivityHeader 是条目的描述与展开栏；业务可组合图标、来源与操作，点击资源不翻转条目。 */
import { TbChevronRight } from "react-icons/tb";
import type { ActivityHeaderProps } from "../types/activity-components";
import { cn } from "../lib/utils";
import { use_activity_item } from "./activity-item";

/** 使用原生 summary 键盘语义，展开事实和正文 ID 由所属 Item 提供。 */
export function ActivityHeader({ children, description_id, metadata, trailing, actions, show_chevron = true, class_name }: ActivityHeaderProps) {
  const item = use_activity_item();
  const content = <>
    <div className="activity-header-row">
      <div id={description_id} className="activity-header-description">{children}</div>
      {item.has_detail && show_chevron ? <TbChevronRight className="activity-header-chevron activity-tool-chevron" aria-hidden /> : null}
      {trailing ? <div className="activity-header-trailing">{trailing}</div> : null}
    </div>
    {metadata ? <div className="activity-header-metadata">{metadata}</div> : null}
    {actions ? <div className="activity-header-actions">{actions}</div> : null}
  </>;
  const header_class = cn("activity-header", class_name);
  if (!item.has_detail) return <div id={item.header_id} className={header_class}>{content}</div>;
  return <summary id={item.header_id} className={header_class} aria-label={item.detail_label}
    aria-expanded={item.open} aria-controls={item.open ? item.detail_id : undefined}
    onClick={(event) => {
      // 使用最近交互节点识别来源与关闭按钮；原生 summary 不接管其独立动作。
      if (event.target instanceof Element && event.target.closest("a[href], button, input, textarea, select, [role=button]")) return;
      event.preventDefault();
      item.toggle();
    }}>{content}</summary>;
}
