/**
 * Memory Power 的功能工作区。
 *
 * Sidebar 只做一件事：平铺列出记忆范围（共享 + 每个 Agent），右侧只显示条目数量。
 * Mainview 有三个视图态：列表、单条详情、以及本 Power 的设置；三者都在工作区内切换，
 * 不会跳出到全局 Powers 目录。所有读写都通过宿主 action 执行，Renderer 不接触 Provider。
 */

import { useCallback, useEffect, useState } from "react";
import { define_power_renderer } from "@downcity/city/power/react";
import type {
  MemoryMainviewListItem,
  MemoryMainviewListResult,
  MemoryMainviewMutationResult,
  MemoryMainviewReadResult,
  MemoryMainviewScopeKind,
  MemoryMainviewSnapshot,
} from "@/memory/types/MemoryMainview.js";

/** 界面一次枚举的条目数量。 */
const PAGE_SIZE = 100;

/** 记忆分类在界面上的名称。 */
const TYPE_LABELS: Record<string, string> = {
  fact: "事实",
  preference: "偏好",
  decision: "决策",
  episode: "经历",
  procedure: "流程",
  document: "文档",
};

/** Provider 状态在界面上的名称。 */
const PROVIDER_STATE_LABELS: Record<string, string> = {
  ready: "就绪",
  degraded: "降级",
};

/** 记忆范围在界面上的名称。 */
const SCOPE_LABELS: Record<MemoryMainviewScopeKind, string> = {
  city: "共享",
  agent: "Agent 私有",
};

/** Memory Power Renderer 定义。 */
export const MEMORY_POWER_RENDERER = define_power_renderer({
  sidebar: function MemoryPowerSidebar({ power, navigation, ui }) {
    const { Callout, LoadingState, Sidebar, SidebarItem, SidebarSection, SidebarSubText } = ui.components;
    const [snapshot, set_snapshot] = useState<MemoryMainviewSnapshot>();
    const [error, set_error] = useState("");
    const scope = read_scope_route(navigation.route);
    const selected_agent_id = read_route(navigation.route.agent_id);

    useEffect(() => {
      let disposed = false;
      set_error("");
      void power.invoke<MemoryMainviewSnapshot>("memory.snapshot", scope_input(navigation.route))
        .then((value) => {
          if (disposed) return;
          set_snapshot(value);
          if (!selected_agent_id && value.agents[0]) {
            navigation.navigate(range_route("agent", value.agents[0].agent_id, value.workspaces[0]?.workspace_id ?? ""));
          }
        })
        .catch((reason) => { if (!disposed) set_error(to_error_message(reason)); });
      return () => { disposed = true; };
    }, [navigation.navigate, power, selected_agent_id, ui.revision]);

    if (!snapshot) return <Sidebar>{error
      ? <Callout tone="danger">{error}</Callout>
      : <LoadingState label="正在读取 Memory…" />}</Sidebar>;

    return <Sidebar>
      <SidebarSection>
        <SidebarItem
          label={SCOPE_LABELS.city}
          trailing={snapshot.city_count}
          active={scope === "city"}
          on_select={() => navigation.navigate(range_route("city", selected_agent_id, current_workspace_id(navigation.route)))}
        />
        {snapshot.agents.map((agent) => <SidebarItem
          key={agent.agent_id}
          label={agent.name}
          trailing={agent.memory_count}
          active={scope === "agent" && selected_agent_id === agent.agent_id}
          on_select={() => navigation.navigate(range_route("agent", agent.agent_id, current_workspace_id(navigation.route)))}
        />)}
        {!snapshot.agents.length ? <SidebarSubText>还没有 Agent</SidebarSubText> : null}
      </SidebarSection>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Sidebar>;
  },

  mainview: function MemoryPowerMainview({ power, navigation, ui }) {
    const {
      Button, Callout, EmptyState, Field, Group, Inline, ItemMenu, LoadingState, Markdown,
      Page, Row, Section, Status, Textarea, Toolbar,
    } = ui.components;
    const [snapshot, set_snapshot] = useState<MemoryMainviewSnapshot>();
    const [listing, set_listing] = useState<MemoryMainviewListResult>();
    const [detail, set_detail] = useState<MemoryMainviewReadResult>();
    const [draft, set_draft] = useState("");
    const [loading, set_loading] = useState(true);
    const [reading, set_reading] = useState(false);
    const [busy, set_busy] = useState(false);
    const [creating, set_creating] = useState(false);
    const [revising, set_revising] = useState(false);
    // 详情视图必须在写入后重新读取，否则修订结果不会出现在正文里。
    const [detail_revision, set_detail_revision] = useState(0);
    const [error, set_error] = useState("");
    const scope = read_scope_route(navigation.route);
    const agent_id = read_route(navigation.route.agent_id);
    const workspace_id = current_workspace_id(navigation.route);
    const memory_id = read_route(navigation.route.memory_id);
    // 设置视图由 route 驱动，与列表、详情共享同一套返回逻辑。
    const view = read_view_route(navigation.route);
    const input = { scope, agent_id, workspace_id };
    const target = scope === "city" ? "current_workspace" : "agent";

    const load = useCallback(async () => {
      set_loading(true);
      set_error("");
      try {
        const [next_snapshot, next_list] = await Promise.all([
          power.invoke<MemoryMainviewSnapshot>("memory.snapshot", input),
          power.invoke<MemoryMainviewListResult>("memory.list", { ...input, limit: PAGE_SIZE }),
        ]);
        set_snapshot(next_snapshot);
        set_listing(next_list);
      } catch (reason) {
        set_error(to_error_message(reason));
      } finally {
        set_loading(false);
      }
    }, [agent_id, power, scope, workspace_id]);
    useEffect(() => { void load(); }, [load, ui.revision]);

    useEffect(() => {
      if (!memory_id) {
        set_detail(undefined);
        return;
      }
      let disposed = false;
      set_reading(true);
      void power.invoke<MemoryMainviewReadResult>("memory.read", { ...input, memory_id })
        .then((value) => { if (!disposed) set_detail(value); })
        .catch((reason) => { if (!disposed) set_error(to_error_message(reason)); })
        .finally(() => { if (!disposed) set_reading(false); });
      return () => { disposed = true; };
    }, [agent_id, detail_revision, memory_id, power, scope, workspace_id]);

    const mutate = async (
      action_id: string,
      payload: object,
      message: string,
    ): Promise<MemoryMainviewMutationResult | undefined> => {
      set_busy(true);
      set_error("");
      try {
        const result = await power.invoke<MemoryMainviewMutationResult>(action_id, {
          ...input,
          ...payload,
        });
        set_listing(result);
        set_detail_revision((value) => value + 1);
        ui.invalidate();
        ui.toast({ type: "success", message });
        return result;
      } catch (reason) {
        const message_value = to_error_message(reason);
        set_error(message_value);
        ui.toast({ type: "error", message: message_value });
        return undefined;
      } finally {
        set_busy(false);
      }
    };

    const save = async () => {
      const content = draft.trim();
      if (!content) return;
      const result = await mutate("memory.remember", { content, target }, "记忆已保存");
      if (result) {
        set_draft("");
        set_creating(false);
      }
    };

    const revise = async () => {
      const instruction = draft.trim();
      if (!instruction || !detail) return;
      const result = await mutate("memory.revise", { memory_id: detail.memory_id, instruction }, "记忆已修订");
      if (result) {
        set_draft("");
        set_revising(false);
      }
    };

    /**
     * 删除一条记忆。
     *
     * 列表与详情共用这一条路径：删除当前详情时回到列表，避免停留在一个已不存在的
     * memory_id 上；删除其他条目时只刷新列表。
     */
    const forget = async (item: { readonly memory_id: string; readonly title: string }) => {
      const confirmed = await ui.confirm({
        title: `删除「${item.title}」？`,
        description: "该记忆会从当前范围永久删除，证据记录会保留。",
        action: "删除",
        destructive: true,
      });
      if (!confirmed) return;
      const result = await mutate("memory.forget", { memory_id: item.memory_id }, "记忆已删除");
      if (result && memory_id === item.memory_id) {
        navigation.navigate(range_route(scope, agent_id, workspace_id));
      }
    };

    const back_to_list = () => navigation.navigate(range_route(scope, agent_id, workspace_id));

    if (loading && !snapshot) return <LoadingState label="正在读取 Memory…" />;
    if (!snapshot) return <Page>{error
      ? <Callout tone="danger">{error}</Callout>
      : <EmptyState title="无法读取 Memory" description="请刷新后重试。" />}</Page>;
    if (!snapshot.agents.length) return <Page><EmptyState
      title="还没有 Agent"
      description="Memory 需要一个 Agent 作为执行上下文，请先创建一个 Agent。"
    /></Page>;

    const scope_label = scope === "city"
      ? SCOPE_LABELS.city
      : snapshot.agents.find((agent) => agent.agent_id === agent_id)?.name ?? SCOPE_LABELS.agent;

    if (view === "settings") return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar
        title="设置"
        description="当前 Provider 与存储状态；布局由 City 与 Provider 决定，界面不可修改。"
        actions={<Inline>
          <Button on_click={back_to_list}>返回列表</Button>
          <Button disabled={loading} on_click={ui.invalidate}>{loading ? "刷新中…" : "刷新"}</Button>
        </Inline>}
      />
      <Group label="Provider">
        <Row label="实现" trailing={<Status>{snapshot.status.provider}</Status>} />
        <Row label="状态" trailing={<Status tone={snapshot.status.state === "ready" ? "success" : "warning"}>{PROVIDER_STATE_LABELS[snapshot.status.state] ?? snapshot.status.state}</Status>} />
        <Row label="枚举记忆" trailing={<Status tone={snapshot.status.supports_list ? "success" : "muted"}>{snapshot.status.supports_list ? "支持" : "不支持"}</Status>} />
        <Row label="共享存储" trailing={<Status tone={snapshot.status.city_memory_available ? "success" : "muted"}>{snapshot.status.city_memory_available ? "已接入" : "未接入"}</Status>} />
      </Group>
      <Group label="存储统计">
        <Row label="存储实现" trailing={<Status>{read_detail_string(snapshot, "storage_adapter")}</Status>} />
        <Row label="Agent 记忆" trailing={<Status>{read_detail_number(snapshot, "agent_memories")}</Status>} />
        <Row label="证据记录" trailing={<Status>{read_detail_number(snapshot, "evidence")}</Status>} />
        <Row label="待处理捕获" trailing={<Status>{read_detail_number(snapshot, "pending_capture_jobs")}</Status>} />
      </Group>
    </Page>;

    const items = listing?.items ?? [];

    if (detail) return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar
        title={detail.found ? detail.title || detail.memory_id : "记忆不存在"}
        description={detail.found ? detail.memory_id : detail.error}
        actions={<Inline>
          <Button on_click={back_to_list}>返回列表</Button>
          {detail.found ? <Button disabled={busy} on_click={() => { set_revising((value) => !value); set_draft(""); }}>{revising ? "取消修订" : "修订"}</Button> : null}
          {detail.found ? <Button variant="destructive" disabled={busy} on_click={() => void forget({ memory_id: detail.memory_id, title: detail.title || detail.memory_id })}>删除</Button> : null}
        </Inline>}
      />
      {detail.found ? <Group>
        <Row label="类型" trailing={<Status>{type_label(detail.memory_type ?? "")}</Status>} />
        <Row label="范围" trailing={<Status>{SCOPE_LABELS[scope]}</Status>} />
        <Row label="观察时间" trailing={<Status>{detail.observed_at ?? ""}</Status>} />
        <Row label="引用" trailing={<Status>{detail.citation ?? detail.memory_id}</Status>} />
        {detail.source_ids?.length ? <Row label="证据" trailing={<Status>{detail.source_ids.length} 条</Status>} /> : null}
      </Group> : null}
      {revising ? <Section title="修订" description="描述要如何修改这条记忆。">
        <Field label="修订指令"><Textarea value={draft} rows={4} placeholder="例如：把默认语言从 JavaScript 改为 TypeScript。" on_value_change={set_draft} /></Field>
        <Inline><Button variant="primary" disabled={busy || !draft.trim()} on_click={() => void revise()}>{busy ? "修订中…" : "提交修订"}</Button></Inline>
      </Section> : null}
      <Section title="内容">
        {reading ? <LoadingState label="正在读取记忆…" />
          : detail.content ? <Markdown text={detail.content} />
            : <EmptyState title="没有可显示的内容" size="compact" />}
      </Section>
    </Page>;

    return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar
        title="Memory"
        description={`${scope_label} · ${snapshot.workspaces.find((item) => item.workspace_id === workspace_id)?.name ?? "未选择 Workspace"}`}
        actions={<Inline>
          <Button disabled={loading} on_click={ui.invalidate}>{loading ? "刷新中…" : "刷新"}</Button>
          <Button on_click={() => navigation.navigate({ ...range_route(scope, agent_id, workspace_id), view: "settings" })}>设置</Button>
          <Button variant="primary" disabled={busy} on_click={() => { set_creating((value) => !value); set_draft(""); }}>{creating ? "取消" : "新建记忆"}</Button>
        </Inline>}
      />
      {creating ? <Section title="新建记忆" description={`写入「${scope_label}」范围。`}>
        <Field label="内容"><Textarea value={draft} rows={5} placeholder="要长期保留的事实、偏好或决策。" on_value_change={set_draft} /></Field>
        <Inline>
          <Button variant="primary" disabled={busy || !draft.trim()} on_click={() => void save()}>{busy ? "保存中…" : "保存"}</Button>
          <Status>写入目标：{scope_label}</Status>
        </Inline>
      </Section> : null}
      {!items.length ? <EmptyState
        title="还没有记忆"
        description="Agent 在会话中形成的长期记忆，或在这里新建的记忆都会出现在列表中。"
        size="compact"
      /> : <Section title={`记忆 · ${items.length}/${listing?.total ?? items.length}`} description={`范围：${scope_label}`}>
        <Group>{items.map((item) => <Row
          key={item.memory_id}
          label={item.title}
          description={`${type_label(item.memory_type)} · ${item.snippet}`}
          trailing={<ItemMenu label={`${item.title} 操作`} reveal_on_hover actions={[
            { action_id: "forget", label: "删除", destructive: true, on_select: () => forget(item) },
          ]} />}
          on_click={() => navigation.navigate({ ...range_route(scope, agent_id, workspace_id), memory_id: item.memory_id })}
        />)}</Group>
      </Section>}
    </Page>;
  },
});

/** Mainview 在工作区内可切换的视图态。 */
type MemoryMainviewView = "list" | "settings";

/** 创建记忆范围的稳定 Power route。 */
function range_route(
  scope: MemoryMainviewScopeKind,
  agent_id: string,
  workspace_id: string,
) {
  return {
    scope,
    ...(agent_id ? { agent_id } : {}),
    ...(workspace_id ? { workspace_id } : {}),
  };
}

/** 读取当前 route 中已经选定的记忆范围；默认查看 Agent 私有记忆。 */
function read_scope_route(route: Record<string, unknown>): MemoryMainviewScopeKind {
  return read_route(route.scope) === "city" ? "city" : "agent";
}

/** 读取 Mainview 当前视图态；未声明时为列表。 */
function read_view_route(route: Record<string, unknown>): MemoryMainviewView {
  return read_route(route.view) === "settings" ? "settings" : "list";
}

/** 读取当前 route 中已经选定的 Workspace ID。 */
function current_workspace_id(route: Record<string, unknown>): string {
  return read_route(route.workspace_id);
}

/** 构造宿主 action 所需的执行范围输入。 */
function scope_input(route: Record<string, unknown>): {
  scope: MemoryMainviewScopeKind;
  agent_id: string;
  workspace_id: string;
} {
  return {
    scope: read_scope_route(route),
    agent_id: read_route(route.agent_id),
    workspace_id: read_route(route.workspace_id),
  };
}

/** 返回记忆分类的用户可见名称。 */
function type_label(memory_type: string): string {
  return TYPE_LABELS[memory_type] ?? memory_type;
}

/** 从 Provider 快照读取一个字符串统计。 */
function read_detail_string(snapshot: MemoryMainviewSnapshot, key: string): string {
  const value = snapshot.status.details?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "未知";
}

/** 从 Provider 快照读取一个数值统计。 */
function read_detail_number(snapshot: MemoryMainviewSnapshot, key: string): string {
  const value = snapshot.status.details?.[key];
  return typeof value === "number" ? String(value) : "未知";
}

/** 从宿主 JSON route 中读取一个可选字符串。 */
function read_route(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 把未知失败转换为用户可见消息。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
