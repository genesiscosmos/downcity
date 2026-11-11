/** Agent 页面中的知识内容管理：固定宿主 Agent 身份，列表、详情和写入均通过授权 action。 */

import { useCallback, useEffect, useState } from "react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type {
  MemoryMainviewListItem,
  MemoryMainviewListResult,
  MemoryMainviewMutationResult,
  MemoryMainviewReadResult,
  MemoryMainviewScopeKind,
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

/** 记忆范围在界面上的名称。 */
const SCOPE_LABELS: Record<MemoryMainviewScopeKind, string> = {
  city: "共享",
  agent: "Agent 私有",
};

/** 当前 Agent 的知识列表与详情，内容管理不承担 Power 配置导航。 */
export function memory_knowledge_view({ power, navigation, ui }: PowerMainviewComponentProps) {
    const {
      Button, Callout, EmptyState, Field, Group, Inline, ItemMenu, LoadingState, Markdown,
      Page, Row, Section, Status, Textarea, Toolbar,
    } = ui.components;
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
    const input = { scope, agent_id, workspace_id };
    const target = scope === "city" ? "current_workspace" : "agent";

    const load = useCallback(async () => {
      set_loading(true);
      set_error("");
      try {
        set_listing(await power.invoke<MemoryMainviewListResult>("memory.list", { ...input, limit: PAGE_SIZE }));
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
        .catch((reason) => { if (!disposed) { set_detail(undefined); set_error(to_error_message(reason)); } })
        .finally(() => { if (!disposed) set_reading(false); });
      return () => { disposed = true; };
    }, [agent_id, detail_revision, memory_id, power, scope, workspace_id, ui.revision]);

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
        ui.toast({ type: "success", message: result.message || message });
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
      const result = await mutate("memory.revise", { memory_id: detail.memory_id, instruction }, "修订请求已提交，请查看处理记录");
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

    if (loading && !listing) return <LoadingState label="正在读取 Agent 记忆…" />;
    if (!listing) return <Page>{error
      ? <Callout tone="danger">{error}</Callout>
      : <EmptyState title="无法读取记忆" description="请刷新后重试。" />}</Page>;
    const scope_label = SCOPE_LABELS[scope];

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
        title="记忆"
        description="当前 Agent 的长期知识。"
        actions={<Inline>
          <Button disabled={loading} on_click={ui.invalidate}>{loading ? "刷新中…" : "刷新"}</Button>
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
}

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

/** 读取当前 route 中已经选定的 Workspace ID。 */
function current_workspace_id(route: Record<string, unknown>): string {
  return read_route(route.workspace_id);
}

/** 返回记忆分类的用户可见名称。 */
function type_label(memory_type: string): string {
  return TYPE_LABELS[memory_type] ?? memory_type;
}

/** 从宿主 JSON route 中读取一个可选字符串。 */
function read_route(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 把未知失败转换为用户可见消息。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
