import type { LucideIcon } from "lucide-react";

/** Fedman 页面稳定标识。 */
export type FedmanPageId =
  | "overview"
  | "activity"
  | "consumption"
  | "retention"
  | "quality"
  | "usage"
  | "users"
  | "sessions"
  | "bureaus"
  | "models"
  | "env"
  | "services"
  | "credits_users"
  | "payments"
  | "debugger";

/** Analytics 查询时间范围。 */
export type AnalyticsRange = "today" | "7d" | "30d" | "all";

/** 左侧导航中的单个页面定义。 */
export interface FedmanPageDefinition {
  /** 页面稳定标识。 */
  id: FedmanPageId;
  /** 导航中显示的 Lucide 图标组件。 */
  icon: LucideIcon;
  /** 页面中文名称。 */
  label: string;
  /** 页面标题下方的用途说明。 */
  description: string;
  /** 页面在导航中的业务分组。 */
  group: string;
  /** 页面是否需要显示 Analytics 时间范围选择器。 */
  analytics: boolean;
}
