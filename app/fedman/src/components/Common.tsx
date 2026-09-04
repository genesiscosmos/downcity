/** Fedman 基于 Downcity UI 的通用展示与状态组件。 */

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
  Spinner,
  cn,
} from "@downcity/ui";
import { CircleAlertIcon, InboxIcon } from "lucide-react";
import type { MessageStateProps, MetricCardsProps, PanelProps, RemoteDataNoticeProps } from "../types/ui.js";

/** 渲染指标卡网格。 */
export function MetricCards({ items }: MetricCardsProps) {
  return <div className="metric-grid">{items.map((item) => <Card className="metric" data-tone={item.tone} key={item.label} size="sm">
    <CardHeader><CardDescription>{item.label}</CardDescription><CardAction>{item.tone === "accent" ? <Badge variant="secondary">核心</Badge> : null}</CardAction></CardHeader>
    <CardContent><strong className="metric-value">{item.value}</strong><p className="metric-hint">{item.hint}</p></CardContent>
  </Card>)}</div>;
}

/** 渲染带标题和元数据的统一面板。 */
export function Panel({ title, meta = "", class_name = "", children }: PanelProps) {
  return <Card className={cn("panel", class_name)}><CardHeader><CardTitle>{title}</CardTitle>{meta ? <CardAction><Badge variant="outline">{meta}</Badge></CardAction> : null}</CardHeader><CardContent>{children}</CardContent></Card>;
}

/** 渲染统一的加载、错误和空数据状态。 */
export function MessageState({ children, tone = "empty", compact = false }: MessageStateProps) {
  if (tone === "loading") return <div className="state-skeleton" data-compact={compact}><div className="state-skeleton-heading"><Spinner /><span>{children}</span></div><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;
  if (tone === "error") return <Alert variant="destructive"><CircleAlertIcon /><div><AlertTitle>数据加载失败</AlertTitle><AlertDescription>{children}</AlertDescription></div></Alert>;
  return <Empty className={compact ? "py-5" : undefined}><EmptyHeader><InboxIcon /><EmptyTitle>暂无数据</EmptyTitle><EmptyDescription>{children}</EmptyDescription></EmptyHeader></Empty>;
}

/** 在保留现有数据时展示后台刷新和刷新失败状态。 */
export function RemoteDataNotice({ refreshing, error }: RemoteDataNoticeProps) {
  if (refreshing) return <div className="remote-data-notice" role="status"><Spinner size="sm" />正在刷新数据…</div>;
  if (error) return <Alert variant="destructive"><CircleAlertIcon /><div><AlertTitle>刷新失败，当前仍展示上次数据</AlertTitle><AlertDescription>{error.message}</AlertDescription></div></Alert>;
  return null;
}
