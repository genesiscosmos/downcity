/** Activity 只持有有序条目的统一间距；Agent 与 Inbox 都通过同一结构组合 ActivityItem。 */
import type { ActivityProps } from "../types/activity-components";
import { cn } from "../lib/utils";

/** 保留 children 的业务顺序与稳定 key，不负责记录分类或详情解析。 */
export function Activity({ children, class_name }: ActivityProps) {
  return <div className={cn("activity", class_name)}>{children}</div>;
}
