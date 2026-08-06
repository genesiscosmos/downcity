/** Fedman 基于 Downcity UI 的应用框架、导航与连接状态。 */

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SidebarLayout,
  Spinner,
  ThemeContainer,
  cn,
} from "@downcity/ui";
import { CircleAlertIcon, LogOutIcon, RefreshCwIcon } from "lucide-react";
import { fedman_pages } from "../config/pages.js";
import type { AnalyticsRange } from "../types/navigation.js";
import type { LayoutProps } from "../types/ui.js";

const range_items: Array<{ label: string; value: AnalyticsRange }> = [
  { label: "今日", value: "today" },
  { label: "7 天", value: "7d" },
  { label: "30 天", value: "30d" },
  { label: "全部", value: "all" },
];

/** 渲染固定侧边栏、页面标题与内容区域。 */
export function Layout(props: LayoutProps) {
  let previous_group = "";
  const context_busy = props.context_state.loading || props.context_state.refreshing;
  const connection_label = props.context_state.error
    ? "连接失败"
    : context_busy
      ? "连接中"
      : "已连接";

  const sidebar_header = <div className="brand"><span className="brand-mark">D</span><div><strong>Downcity</strong><small>FEDERATION MANAGER</small></div></div>;
  const sidebar_footer = <div className="connection">
    <div className="connection-heading"><span>FEDERATION</span><Badge variant={props.context_state.error ? "destructive" : "secondary"}>{context_busy ? <Spinner size="sm" /> : null}{connection_label}</Badge></div>
    <strong>{props.context_state.data?.federation_name ?? "等待连接"}</strong>
    <span>{props.context_state.data?.federation_url ?? props.context_state.error?.message ?? "正在读取本地控制面"}</span>
  </div>;

  return (
    <ThemeContainer className="fedman-theme" mode="light" variant="neutral">
      <div className="shell">
        <aside className="sidebar"><SidebarLayout header={sidebar_header} footer={sidebar_footer}>
          <nav className="navigation" aria-label="Fedman 主导航">
            {fedman_pages.map((item) => {
              const show_group = item.group !== previous_group;
              const active = props.page.id === item.id;
              const Icon = item.icon;
              previous_group = item.group;
              return <div className="nav-entry" key={item.id}>
                {show_group ? <div className="nav-label">{item.group}</div> : null}
                <Button className="nav-item" variant={active ? "default" : "ghost"} onClick={() => props.on_page_change(item.id)}>
                  <Icon data-icon="inline-start" /><span>{item.label}</span>
                </Button>
              </div>;
            })}
          </nav>
        </SidebarLayout></aside>
        <main className="main-content">
          <header className="page-header">
            <div><p className="eyebrow">LOCAL CONTROL PLANE</p><h1>{props.page.label}</h1><p>{props.page.description}</p></div>
            <div className="header-actions">
              {props.page.analytics ? <Select items={range_items} value={props.range} onValueChange={(value) => props.on_range_change(value as AnalyticsRange)}>
                <SelectTrigger aria-label="分析时间范围"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{range_items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
              </Select> : null}
              <Button disabled={context_busy} variant="outline" onClick={props.on_refresh}>
                {context_busy ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
                {context_busy ? "刷新中" : "刷新"}
              </Button>
              <Button variant="ghost" onClick={props.on_logout}><LogOutIcon data-icon="inline-start" />退出</Button>
            </div>
          </header>
          {props.context_state.error && !props.context_state.data ? <Alert variant="destructive"><CircleAlertIcon /><div><AlertTitle>Federation 连接失败</AlertTitle><AlertDescription>{props.context_state.error.message}</AlertDescription></div></Alert> : null}
          <section className={cn("page-content", context_busy && "is-refreshing")} aria-live="polite">{props.children}</section>
        </main>
      </div>
    </ThemeContainer>
  );
}
