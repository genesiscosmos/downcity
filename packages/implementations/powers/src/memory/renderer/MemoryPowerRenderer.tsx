/**
 * Memory Power 的功能工作区。
 *
 * Sidebar 以 Agent 为根，按记忆范围列出各 Subject 的条目数量；Mainview 在共享 route
 * 上完成筛选、召回、浏览、详情与写入。所有读写都通过宿主 action 在指定 Agent 与
 * Workspace 上执行，Renderer 不接触 Provider，也不解析物理存储路径。
 */

import { useCallback, useEffect, useState } from "react";
import { define_power_renderer } from "@downcity/city/power/react";
import type { MemorySubjectKind } from "@/memory/types/MemoryAccess.js";
import type {
  MemoryMainviewListItem,
  MemoryMainviewListResult,
  MemoryMainviewMutationResult,
  MemoryMainviewReadResult,
  MemoryMainviewSnapshot,
} from "@/memory/types/MemoryMainview.js";

/** Memory 支持的全部记忆分类。 */
const MEMORY_TYPES = [
  "fact",
  "preference",
  "decision",
  "episode",
  "procedure",
  "document",
] as const;

/** 界面一次枚举的条目数量。 */
const PAGE_SIZE = 100;

/** 写入目标在界面上的名称。 */
const TARGET_LABELS: Record<string, string> = {
  current_user: "当前用户",
  current_workspace: "当前 Workspace",
  agent: "当前 Agent",
};

/** 记忆分类在界面上的名称。 */
const TYPE_LABELS: Record<string, string> = {
  fact: "事实",
  preference: "偏好",
  decision: "决策",
  episode: "经历",
  procedure: "流程",
  document: "文档",
};

/** Subject 类别在界面上的名称。 */
const SUBJECT_LABELS: Record<MemorySubjectKind, string> = {
  agent: "Agent",
  user: "用户",
  workspace: "Workspace",
  city: "City 共享",
};

/** Memory Power Renderer 定义。 */
export const MEMORY_POWER_RENDERER = define_power_renderer({
  sidebar: function MemoryPowerSidebar({ power, navigation, ui }) {
    const {
      Callout, LoadingState, Sidebar, SidebarItem, SidebarSection, SidebarSubText, Status,
    } = ui.components;
    const [snapshot, set_snapshot] = useState<MemoryMainviewSnapshot>();
    const [counts, set_counts] = useState<MemoryMainviewListResult>();
    const [error, set_error] = useState("");
    const selected_agent_id = read_route(navigation.route.agent_id);
    const selected_subject = read_subject_route(navigation.route.subject);

    useEffect(() => {
      let disposed = false;
      set_error("");
      const scope = scope_input(navigation.route);
      void power.invoke<MemoryMainviewSnapshot>("memory.snapshot", scope)
        .then(async (value) => {
          if (disposed) return;
          set_snapshot(value);
          if (!selected_agent_id && value.agents[0]) {
            navigation.navigate(agent_route(value.agents[0].agent_id, value.workspaces[0]?.workspace_id ?? ""));
          }
          // 各范围的数量必须来自枚举本身；Provider 的 agent_memories 只描述 Agent Store。
          const listed = await power.invoke<MemoryMainviewListResult>("memory.list", { ...scope, limit: 1 });
          if (!disposed) set_counts(listed);
        })
        .catch((reason) => { if (!disposed) set_error(to_error_message(reason)); });
      return () => { disposed = true; };
    }, [navigation.navigate, power, selected_agent_id, ui.revision]);

    if (!snapshot) return <Sidebar>{error
      ? <Callout tone="danger">{error}</Callout>
      : <LoadingState label="正在读取 Memory…" />}</Sidebar>;

    return <Sidebar>
      <SidebarSection label="Agents">
        {snapshot.agents.map((agent) => <SidebarItem
          key={agent.agent_id}
          label={agent.name}
          description={agent.agent_id}
          active={selected_agent_id === agent.agent_id && !selected_subject}
          on_select={() => navigation.navigate(agent_route(agent.agent_id, current_workspace_id(navigation.route)))}
        />)}
        {!snapshot.agents.length ? <SidebarSubText>还没有 Agent</SidebarSubText> : null}
      </SidebarSection>
      {snapshot.agents.length ? <SidebarSection label="范围">
        <SidebarItem
          label="全部记忆"
          trailing={counts?.total}
          active={!selected_subject}
          on_select={() => navigation.navigate(agent_route(selected_agent_id, current_workspace_id(navigation.route)))}
        />
        {(Object.keys(SUBJECT_LABELS) as MemorySubjectKind[])
          .filter((kind) => kind !== "city" || snapshot.status.city_memory_available)
          .map((kind) => <SidebarItem
            key={kind}
            label={SUBJECT_LABELS[kind]}
            trailing={counts?.subject_counts[kind]}
            active={selected_subject === kind}
            on_select={() => navigation.navigate(agent_route(selected_agent_id, current_workspace_id(navigation.route), kind))}
          />)}
      </SidebarSection> : null}
      <SidebarSection label="Provider">
        <SidebarItem
          label={snapshot.status.provider}
          trailing={<Status tone={snapshot.status.state === "ready" ? "success" : "warning"}>{snapshot.status.state}</Status>}
          on_select={() => undefined}
        />
        {!snapshot.status.supports_list ? <SidebarSubText>当前 Provider 不支持枚举，只能按关键词召回</SidebarSubText> : null}
        {!snapshot.status.city_memory_available ? <SidebarSubText>未接入 City 共享 Store</SidebarSubText> : null}
      </SidebarSection>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Sidebar>;
  },

  mainview: function MemoryPowerMainview({ power, navigation, ui }) {
    const {
      Button, Callout, CodeBlock, EmptyState, Field, Group, Inline, Input, ItemMenu,
      LoadingState, Markdown, Page, Row, Section, Select, Status, Textarea, Toolbar,
    } = ui.components;
    const [snapshot, set_snapshot] = useState<MemoryMainviewSnapshot>();
    const [listing, set_listing] = useState<MemoryMainviewListResult>();
    const [detail, set_detail] = useState<MemoryMainviewReadResult>();
    const [draft, set_draft] = useState("");
    const [query, set_query] = useState("");
    const [recall_query, set_recall_query] = useState("");
    const [filter, set_filter] = useState("");
    const [type_filter, set_type_filter] = useState("all");
    const [loading, set_loading] = useState(true);
    const [reading, set_reading] = useState(false);
    const [busy, set_busy] = useState(false);
    const [creating, set_creating] = useState(false);
    const [revising, set_revising] = useState(false);
    // 详情视图必须在写入后重新读取，否则修订结果不会出现在正文里。
    const [detail_revision, set_detail_revision] = useState(0);
    const [error, set_error] = useState("");
    const agent_id = read_route(navigation.route.agent_id);
    const workspace_id = current_workspace_id(navigation.route);
    const subject = read_subject_route(navigation.route);
    const memory_id = read_route(navigation.route.memory_id);
    const scope = { agent_id, workspace_id };

    const load = useCallback(async () => {
      set_loading(true);
      set_error("");
      try {
        const [next_snapshot, next_list] = await Promise.all([
          power.invoke<MemoryMainviewSnapshot>("memory.snapshot", scope),
          power.invoke<MemoryMainviewListResult>("memory.list", {
            ...scope,
            limit: PAGE_SIZE,
            ...(subject ? { subject_kinds: [subject] } : {}),
          }),
        ]);
        set_snapshot(next_snapshot);
        set_listing(next_list);
        set_recall_query("");
      } catch (reason) {
        set_error(to_error_message(reason));
      } finally {
        set_loading(false);
      }
    }, [agent_id, power, subject, workspace_id]);
    useEffect(() => { void load(); }, [load, ui.revision]);

    useEffect(() => {
      if (!memory_id) {
        set_detail(undefined);
        return;
      }
      let disposed = false;
      set_reading(true);
      void power.invoke<MemoryMainviewReadResult>("memory.read", { ...scope, memory_id })
        .then((value) => { if (!disposed) set_detail(value); })
        .catch((reason) => { if (!disposed) set_error(to_error_message(reason)); })
        .finally(() => { if (!disposed) set_reading(false); });
      return () => { disposed = true; };
    }, [agent_id, detail_revision, memory_id, power, workspace_id]);

    const mutate = async (
      action_id: string,
      input: object,
      message: string,
    ): Promise<MemoryMainviewMutationResult | undefined> => {
      set_busy(true);
      set_error("");
      try {
        const result = await power.invoke<MemoryMainviewMutationResult>(action_id, {
          ...scope,
          ...input,
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

    const target = write_target(subject);
    const save = async () => {
      const content = draft.trim();
      if (!content || !target) return;
      const result = await mutate("memory.remember", {
        content,
        target,
        ...(type_filter === "all" ? {} : { memory_type: type_filter }),
      }, "记忆已保存");
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
    const forget = async (target: { readonly memory_id: string; readonly title: string }) => {
      const confirmed = await ui.confirm({
        title: `删除「${target.title}」？`,
        description: "该记忆会从当前范围永久删除，证据记录会保留。",
        action: "删除",
        destructive: true,
      });
      if (!confirmed) return;
      const result = await mutate("memory.forget", { memory_id: target.memory_id }, "记忆已删除");
      if (result && memory_id === target.memory_id) {
        navigation.navigate(agent_route(agent_id, workspace_id, subject));
      }
    };

    const recall = async () => {
      const normalized_query = query.trim();
      if (!normalized_query) return;
      set_busy(true);
      set_error("");
      try {
        const result = await power.invoke<MemoryMainviewListResult>("memory.recall", {
          ...scope,
          query: normalized_query,
          max_results: 20,
          include_evidence: true,
        });
        set_listing(result);
        set_recall_query(normalized_query);
      } catch (reason) {
        set_error(to_error_message(reason));
      } finally {
        set_busy(false);
      }
    };

    const reset_recall = () => {
      set_recall_query("");
      void load();
    };

    if (loading && !snapshot) return <LoadingState label="正在读取 Memory…" />;
    if (!snapshot) return <Page>{error
      ? <Callout tone="danger">{error}</Callout>
      : <EmptyState title="无法读取 Memory" description="请刷新后重试。" />}</Page>;
    if (!snapshot.agents.length) return <Page><EmptyState
      title="还没有 Agent"
      description="先在 Downcity 中创建一个 Agent，Memory 才能绑定执行范围。"
    /></Page>;

    const items = filter_items(listing?.items ?? [], filter, type_filter);
    const workspace = snapshot.workspaces.find((item) => item.workspace_id === workspace_id);

    if (detail) return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar
        title={detail.found ? detail.title || detail.memory_id : "记忆不存在"}
        description={detail.found ? detail.memory_id : detail.error}
        actions={<Inline>
          <Button on_click={() => navigation.navigate(agent_route(agent_id, workspace_id, subject))}>返回列表</Button>
          {detail.found ? <Button variant="primary" disabled={busy} on_click={() => { set_revising((value) => !value); set_draft(""); }}>{revising ? "取消修订" : "修订"}</Button> : null}
          {detail.found ? <Button variant="destructive" disabled={busy} on_click={() => void forget({ memory_id: detail.memory_id, title: detail.title || detail.memory_id })}>删除</Button> : null}
        </Inline>}
      />
      {detail.found ? <Group>
        <Row label="类型" trailing={<Status>{type_label(detail.memory_type ?? "")}</Status>} />
        <Row label="范围" trailing={<Status>{detail.subject ? SUBJECT_LABELS[detail.subject.kind] : ""}</Status>} />
        <Row label="观察时间" trailing={<Status>{detail.observed_at ?? ""}</Status>} />
        <Row label="引用" trailing={<Status>{detail.citation ?? detail.memory_id}</Status>} />
        {detail.source_ids?.length ? <Row label="证据" trailing={<Status>{detail.source_ids.length} 条</Status>} /> : null}
      </Group> : null}
      {revising ? <Section title="修订" description="描述要如何修改这条记忆；可选补充新证据。">
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
        description={`${agent_name(snapshot, agent_id)} · ${workspace?.name ?? "未选择 Workspace"}`}
        actions={<Inline>
          <Select
            value={workspace_id}
            options={snapshot.workspaces.map((item) => ({ value: item.workspace_id, label: item.name }))}
            on_value_change={(value) => navigation.navigate(agent_route(agent_id, value, subject))}
          />
          <Button disabled={loading} on_click={ui.invalidate}>{loading ? "刷新中…" : "刷新"}</Button>
          <Button variant="primary" disabled={busy || !target} on_click={() => { set_creating((value) => !value); set_draft(""); }}>{creating ? "取消" : "新建记忆"}</Button>
        </Inline>}
      />
      {!target ? <Callout tone="warning">City 共享记忆在当前访问上下文里是只读的，请先切换到 Agent、用户或 Workspace 范围再新建。</Callout> : null}
      {creating && target ? <Section title="新建记忆" description={`写入${TARGET_LABELS[target]}的长期记忆。`}>
        <Field label="内容"><Textarea value={draft} rows={5} placeholder="要长期保留的事实、偏好或决策。" on_value_change={set_draft} /></Field>
        <Inline>
          <Button variant="primary" disabled={busy || !draft.trim()} on_click={() => void save()}>{busy ? "保存中…" : "保存"}</Button>
          <Status>写入目标：{TARGET_LABELS[target]}</Status>
          {target === "current_user" ? <Status tone="warning">需要已认证用户，否则写入会失败</Status> : null}
        </Inline>
      </Section> : null}
      <Group label="筛选">
        <Row label="关键词" trailing={<Input fill value={filter} placeholder="按标题、内容或 ID 过滤" on_value_change={set_filter} />} />
        <Row label="类型" trailing={<Select value={type_filter} options={[
          { value: "all", label: "全部类型" },
          ...MEMORY_TYPES.map((type) => ({ value: type, label: type_label(type) })),
        ]} on_value_change={set_type_filter} />} />
        <Row label="召回" description="在当前 Agent 与 Workspace 上按关键词召回，结果可包含证据记录。" trailing={<Inline fill>
          <Input fill value={query} placeholder="输入查询关键词" on_value_change={set_query} />
          <Button disabled={busy || !query.trim()} on_click={() => void recall()}>{busy ? "处理中…" : "召回"}</Button>
          {recall_query ? <Button on_click={reset_recall}>清除召回</Button> : null}
        </Inline>} />
      </Group>
      {!snapshot.status.supports_list ? <Callout tone="warning">当前 Provider 不支持枚举，列表可能为空；请使用关键词召回。</Callout> : null}
      {!items.length ? <EmptyState
        title={recall_query ? `没有匹配「${recall_query}」的记忆` : filter.trim() || type_filter !== "all" ? "没有匹配的记忆" : "还没有记忆"}
        description="Agent 在会话中形成的长期记忆，或在这里新建的记忆都会出现在列表中。"
        size="compact"
      /> : <Section
        title={recall_query ? `召回结果 · ${items.length}` : `记忆 · ${items.length}/${listing?.total ?? items.length}`}
        description={recall_query
          ? `关键词：${recall_query}`
          : subject ? `范围：${SUBJECT_LABELS[subject]}` : "范围：全部可读 Subject"}
      >
        <Group>{items.map((item) => <Row
          key={item.memory_id}
          label={item.title}
          description={`${type_label(item.memory_type)} · ${SUBJECT_LABELS[item.subject.kind]} · ${item.snippet}`}
          trailing={<ItemMenu label={`${item.title} 操作`} reveal_on_hover actions={[
            { action_id: "forget", label: "删除", destructive: true, on_select: () => forget(item) },
          ]} />}
          on_click={() => navigation.navigate({ ...agent_route(agent_id, workspace_id, subject), memory_id: item.memory_id })}
        />)}</Group>
      </Section>}
      {listing && listing.total > items.length && !filter.trim() && type_filter === "all" && !recall_query
        ? <CodeBlock>{`仅显示前 ${items.length} 条，共 ${listing.total} 条。使用筛选缩小范围。`}</CodeBlock>
        : null}
    </Page>;
  },
});

/** 创建 Agent 范围的稳定 Power route。 */
function agent_route(agent_id: string, workspace_id: string, subject?: MemorySubjectKind) {
  return {
    ...(agent_id ? { agent_id } : {}),
    ...(workspace_id ? { workspace_id } : {}),
    ...(subject ? { subject } : {}),
  };
}

/** 读取当前 route 中已经选定的 Workspace ID。 */
function current_workspace_id(route: Record<string, unknown>): string {
  return read_route(route.workspace_id);
}

/** 构造宿主 action 所需的执行范围输入。 */
function scope_input(route: Record<string, unknown>): { agent_id: string; workspace_id: string } {
  return { agent_id: read_route(route.agent_id), workspace_id: read_route(route.workspace_id) };
}

/** 按关键词与类型过滤列表。 */
function filter_items(
  items: MemoryMainviewListItem[],
  filter: string,
  type_filter: string,
): MemoryMainviewListItem[] {
  const normalized = filter.trim().toLowerCase();
  return items
    .filter((item) => type_filter === "all" || item.memory_type === type_filter)
    .filter((item) => !normalized
      || `${item.title} ${item.snippet} ${item.memory_id}`.toLowerCase().includes(normalized));
}

/**
 * 把当前 route 的记忆范围映射为写入目标。
 *
 * 关键点（中文）：City 共享记忆在当前访问上下文里是只读的，没有对应写入目标；
 * 返回空值让界面明确禁止写入，而不是静默写到另一个范围。
 */
function write_target(subject: MemorySubjectKind | undefined): string | undefined {
  if (subject === "user") return "current_user";
  if (subject === "workspace") return "current_workspace";
  if (subject === "city") return undefined;
  return "agent";
}

/** 返回记忆分类的用户可见名称。 */
function type_label(memory_type: string): string {
  return TYPE_LABELS[memory_type] ?? memory_type;
}

/** 返回 Agent 的用户可见名称。 */
function agent_name(snapshot: MemoryMainviewSnapshot, agent_id: string): string {
  return snapshot.agents.find((agent) => agent.agent_id === agent_id)?.name ?? "未选择 Agent";
}

/** 从宿主 JSON route 读取一个可选 Subject 类别。 */
function read_subject_route(value: unknown): MemorySubjectKind | undefined {
  if (value === "agent" || value === "user" || value === "workspace" || value === "city") return value;
  return undefined;
}

/** 从宿主 JSON route 中读取一个可选字符串。 */
function read_route(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 把未知失败转换为用户可见消息。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
