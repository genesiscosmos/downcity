/** Fedman 页面与导航配置。 */

import {
  ActivityIcon,
  BoxesIcon,
  BoxIcon,
  BugIcon,
  ChartNoAxesCombinedIcon,
  Clock3Icon,
  CoinsIcon,
  CreditCardIcon,
  DatabaseIcon,
  GaugeIcon,
  KeyRoundIcon,
  Layers3Icon,
  UsersIcon,
} from "lucide-react";
import type { FedmanPageDefinition, FedmanPageId } from "../types/navigation.js";

export const fedman_pages: FedmanPageDefinition[] = [
  { id: "overview", icon: GaugeIcon, label: "数据概览", description: "活跃、调用、Token 与 Credits 全局趋势", group: "分析", analytics: true },
  { id: "activity", icon: ActivityIcon, label: "用户活跃", description: "DAU、WAU、MAU 与活跃时间分布", group: "分析", analytics: true },
  { id: "consumption", icon: ChartNoAxesCombinedIcon, label: "Usage 消耗", description: "调用、Token、Credits、模型与 Action", group: "分析", analytics: true },
  { id: "retention", icon: Layers3Icon, label: "用户留存", description: "注册 Cohort 的 D1 / D3 / D7 / D14 / D30 留存", group: "分析", analytics: true },
  { id: "quality", icon: Clock3Icon, label: "调用质量", description: "成功率、计量可靠性与执行耗时", group: "分析", analytics: true },
  { id: "usage", icon: DatabaseIcon, label: "用户明细", description: "各用户调用、Token、Credits 与耗时", group: "分析", analytics: true },
  { id: "users", icon: UsersIcon, label: "用户", description: "Federation 用户记录", group: "管理", analytics: false },
  { id: "sessions", icon: KeyRoundIcon, label: "Sessions", description: "登录会话状态", group: "管理", analytics: false },
  { id: "bureaus", icon: BoxesIcon, label: "产品 / Bureau", description: "产品身份与授权域", group: "管理", analytics: false },
  { id: "models", icon: BoxIcon, label: "模型", description: "模型目录与就绪状态", group: "资源", analytics: false },
  { id: "env", icon: KeyRoundIcon, label: "环境变量", description: "运行环境配置", group: "资源", analytics: false },
  { id: "services", icon: BoxesIcon, label: "Services", description: "服务目录", group: "资源", analytics: false },
  { id: "credits_users", icon: CoinsIcon, label: "Credits", description: "用户余额与交易", group: "交易", analytics: false },
  { id: "payments", icon: CreditCardIcon, label: "支付", description: "支付与 Webhook", group: "交易", analytics: false },
  { id: "debugger", icon: BugIcon, label: "Service 调试", description: "受限 GET / POST 调试器", group: "工具", analytics: false },
];

/** 按稳定 ID 读取页面配置。 */
export function find_fedman_page(page_id: FedmanPageId): FedmanPageDefinition {
  return fedman_pages.find((page) => page.id === page_id) ?? fedman_pages[0];
}
