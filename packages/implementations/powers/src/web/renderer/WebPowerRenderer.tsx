/**
 * Web Power 的功能工作区。
 *
 * 界面是只读状态页：Sidebar 汇总三类能力的可用性与浏览器会话，Mainview 展示当前
 * Provider 解析结果、配置摘要与活跃会话。所有事实都来自宿主 action，界面不回显
 * API Key，也不自行推断可用性。
 */

import { useCallback, useEffect, useState } from "react";
import { define_power_renderer } from "@downcity/city/power/react";
import { WebPowerConfigRenderer } from "@/web/renderer/WebPowerConfigRenderer.js";
import type {
  WebMainviewCapabilityStatus,
  WebMainviewSessionsResult,
  WebMainviewSnapshot,
} from "@/web/types/WebMainview.js";

/** 能力区的展示顺序与名称。 */
const CAPABILITY_ORDER: ReadonlyArray<{
  /** 快照中对应的能力字段。 */
  readonly key: "search" | "document" | "browser";
  /** 用户可见名称。 */
  readonly label: string;
}> = [
  { key: "search", label: "搜索" },
  { key: "document", label: "网页读取" },
  { key: "browser", label: "浏览器" },
];

/** Web Power Renderer 定义。 */
export const WEB_POWER_RENDERER = define_power_renderer({
  sidebar: function WebPowerSidebar({ power, navigation, ui }) {
    const {
      Callout, LoadingState, Sidebar, SidebarItem, SidebarSection, SidebarSubText, Status,
    } = ui.components;
    const [snapshot, set_snapshot] = useState<WebMainviewSnapshot>();
    const [sessions, set_sessions] = useState<WebMainviewSessionsResult>();
    const [error, set_error] = useState("");
    const agent_id = read_route(navigation.route.agent_id);
    const workspace_id = read_route(navigation.route.workspace_id);

    useEffect(() => {
      let disposed = false;
      set_error("");
      const scope = { agent_id, workspace_id };
      void power.invoke<WebMainviewSnapshot>("web.snapshot", scope)
        .then(async (value) => {
          if (disposed) return;
          set_snapshot(value);
          const next_sessions = await power.invoke<WebMainviewSessionsResult>("web.sessions", scope);
          if (!disposed) set_sessions(next_sessions);
        })
        .catch((reason) => { if (!disposed) set_error(to_error_message(reason)); });
      return () => { disposed = true; };
    }, [agent_id, power, ui.revision, workspace_id]);

    if (!snapshot) return <Sidebar>{error
      ? <Callout tone="danger">{error}</Callout>
      : <LoadingState label="正在读取 Web 能力…" />}</Sidebar>;

    return <Sidebar>
      <SidebarSection label="能力">
        {CAPABILITY_ORDER.map(({ key, label }) => <SidebarItem
          key={key}
          label={label}
          description={capability_description(snapshot[key])}
          trailing={<Status tone={snapshot[key].available ? "success" : "muted"}>{snapshot[key].available ? "可用" : "不可用"}</Status>}
          on_select={() => undefined}
        />)}
      </SidebarSection>
      <SidebarSection label="浏览器会话">
        {sessions?.sessions.map((session) => <SidebarItem
          key={session.session_id}
          label={session.title || session.url || "未命名页面"}
          description={session.url}
          trailing={<Status tone="muted">{`第 ${session.observation_generation} 代`}</Status>}
          on_select={() => undefined}
        />)}
        {!sessions ? <SidebarSubText>正在读取会话…</SidebarSubText> : null}
        {sessions && sessions.sessions.length === 0 ? <SidebarSubText>{sessions.note || "当前没有活跃会话"}</SidebarSubText> : null}
      </SidebarSection>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Sidebar>;
  },

  mainview: function WebPowerMainview({ power, navigation, ui }) {
    const {
      Button, Callout, EmptyState, Group, Inline, LoadingState, Page, Row, Section,
      Select, Status, Toolbar,
    } = ui.components;
    const [snapshot, set_snapshot] = useState<WebMainviewSnapshot>();
    const [sessions, set_sessions] = useState<WebMainviewSessionsResult>();
    const [loading, set_loading] = useState(true);
    const [error, set_error] = useState("");
    const agent_id = read_route(navigation.route.agent_id);
    const workspace_id = read_route(navigation.route.workspace_id);

    const load = useCallback(async () => {
      set_loading(true);
      set_error("");
      const scope = { agent_id, workspace_id };
      try {
        const next = await power.invoke<WebMainviewSnapshot>("web.snapshot", scope);
        set_snapshot(next);
        set_sessions(await power.invoke<WebMainviewSessionsResult>("web.sessions", scope));
      } catch (reason) {
        set_error(to_error_message(reason));
      } finally {
        set_loading(false);
      }
    }, [agent_id, power, workspace_id]);
    useEffect(() => { void load(); }, [load, ui.revision]);

    if (loading && !snapshot) return <LoadingState label="正在读取 Web 能力…" />;
    if (!snapshot) return <Page>{error
      ? <Callout tone="danger">{error}</Callout>
      : <EmptyState title="无法读取 Web 能力" description="请刷新后重试。" />}</Page>;
    if (!snapshot.agents.length || !snapshot.workspaces.length) return <Page><EmptyState
      title="缺少执行范围"
      description="Web 能力按 Agent 与 Workspace 解析；请先创建两者中的缺失项。"
    /></Page>;

    return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar
        title="Web"
        description="只读状态页：展示当前实际生效的 Provider 与浏览器会话。"
        actions={<Inline>
          <Select
            value={agent_id || snapshot.agents[0]?.agent_id || ""}
            options={snapshot.agents.map((agent) => ({ value: agent.agent_id, label: agent.name }))}
            on_value_change={(value) => navigation.navigate({ agent_id: value, workspace_id })}
          />
          <Select
            value={workspace_id || snapshot.workspaces[0]?.workspace_id || ""}
            options={snapshot.workspaces.map((workspace) => ({ value: workspace.workspace_id, label: workspace.name }))}
            on_value_change={(value) => navigation.navigate({ agent_id, workspace_id: value })}
          />
          <Button disabled={loading} on_click={ui.invalidate}>{loading ? "刷新中…" : "刷新"}</Button>
        </Inline>}
      />
      {snapshot.warnings.length ? <Callout tone="warning">{snapshot.warnings.join("；")}</Callout> : null}
      <Section title="能力" description="按当前配置与环境变量解析出的实际 Provider。">
        <Group>{CAPABILITY_ORDER.map(({ key, label }) => <Row
          key={key}
          label={label}
          description={snapshot[key].note}
          trailing={<Status tone={snapshot[key].available ? "success" : "muted"}>{capability_description(snapshot[key])}</Status>}
        />)}</Group>
      </Section>
      <Section title="配置摘要" description="API Key 只在设置中写入，此处只显示是否已配置。">
        <Group>
          <Row label="Search provider" trailing={<Status>{snapshot.config.search_provider}</Status>} />
          <Row label="Document provider" trailing={<Status>{snapshot.config.document_provider}</Status>} />
          <Row label="Browser provider" trailing={<Status>{snapshot.config.browser_provider}</Status>} />
          <Row label="Tavily API Key" trailing={<Status tone={snapshot.config.tavily_api_key_configured ? "success" : "muted"}>{snapshot.config.tavily_api_key_configured ? "已配置" : "未配置"}</Status>} />
          <Row label="Exa API Key" trailing={<Status tone={snapshot.config.exa_api_key_configured ? "success" : "muted"}>{snapshot.config.exa_api_key_configured ? "已配置" : "未配置"}</Status>} />
          <Row label="Firecrawl API Key" trailing={<Status tone={snapshot.config.firecrawl_api_key_configured ? "success" : "muted"}>{snapshot.config.firecrawl_api_key_configured ? "已配置" : "未配置"}</Status>} />
          <Row label="CDP endpoint" trailing={<Status>{snapshot.config.cdp_url || "未设置"}</Status>} />
          <Row label="默认 URL" trailing={<Status>{snapshot.config.default_url || "about:blank"}</Status>} />
          <Row label="操作超时" trailing={<Status>{`${snapshot.config.timeout_ms} ms`}</Status>} />
          <Row label="观察字符上限" trailing={<Status>{String(snapshot.config.max_observation_chars)}</Status>} />
        </Group>
      </Section>
      <Section title="浏览器会话" description="会话由 Provider 拥有；创建、观察与关闭仍由 Agent 在会话中执行。">
        {!sessions?.available ? <EmptyState title="浏览器能力不可用" description={sessions?.note} size="compact" />
          : !sessions.sessions.length ? <EmptyState title="当前没有活跃会话" description={sessions.note} size="compact" />
            : <Group>{sessions.sessions.map((session) => <Row
              key={session.session_id}
              label={session.title || session.url || "未命名页面"}
              description={session.url}
              trailing={<Status>{`第 ${session.observation_generation} 代`}</Status>}
            />)}</Group>}
      </Section>
    </Page>;
  },

  config: WebPowerConfigRenderer,
});

/** 返回能力当前的可用性或选择说明。 */
function capability_description(capability: WebMainviewCapabilityStatus): string {
  return capability.available ? capability.provider : capability.note;
}

/** 从宿主 JSON route 中读取一个可选字符串。 */
function read_route(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 把未知失败转换为用户可见消息。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
