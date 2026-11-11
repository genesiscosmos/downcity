/** Agent 页面中的记忆列表与创建、删除操作；详情交给宿主管理的独立视图。 */

import { useCallback, useEffect, useState } from "react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type {
  MemoryMainviewListResult,
  MemoryMainviewMutationResult,
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

/** 当前 Agent 的记忆列表内容，可嵌入 Profile 分区，状态由组件自身持有。 */
export function Memory_knowledge_content({ power, navigation, ui }: PowerMainviewComponentProps) {
    const {
      Button, Callout, EmptyState, Field, Group, Inline, ItemMenu, LoadingState,
      Row, Section, Status, Textarea, Toolbar,
    } = ui.components;
    const [listing, set_listing] = useState<MemoryMainviewListResult>();
    const [draft, set_draft] = useState("");
    const [loading, set_loading] = useState(true);
    const [busy, set_busy] = useState(false);
    const [creating, set_creating] = useState(false);
    const [error, set_error] = useState("");
    const scope = read_scope_route(navigation.route);
    const agent_id = read_route(navigation.route.agent_id);
    const workspace_id = current_workspace_id(navigation.route);
    const input = { scope, agent_id, workspace_id };
    const target = scope === "city" ? "current_workspace" : "agent";

    const load = useCallback(async () => {
      set_loading(true);
      set_error("");
      try {
        set_listing(await power.invoke<MemoryMainviewListResult>("memory.list", { ...input, subject_kinds: [scope], limit: PAGE_SIZE }));
      } catch (reason) {
        set_error(to_error_message(reason));
      } finally {
        set_loading(false);
      }
    }, [agent_id, power, scope, workspace_id]);
    useEffect(() => { void load(); }, [load, ui.revision]);

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
        if (!result.operation_success) throw new Error(result.error || "操作失败");
        set_listing(result);
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

    /** 列表删除只更新当前范围，不影响宿主已打开的详情 tab。 */
    const forget = async (item: { readonly memory_id: string; readonly title: string }) => {
      const confirmed = await ui.confirm({
        title: `删除「${item.title}」？`,
        description: "该记忆会从当前范围永久删除，证据记录会保留。",
        action: "删除",
        destructive: true,
      });
      if (!confirmed) return;
      await mutate("memory.forget", { memory_id: item.memory_id }, "记忆已删除");
    };

    if (loading && !listing) return <LoadingState label="正在读取 Agent 记忆…" />;
    if (!listing) return <>{error
      ? <Callout tone="danger">{error}</Callout>
      : <EmptyState title="无法读取记忆" description="请刷新后重试。" />}</>;
    const scope_label = SCOPE_LABELS[scope];

    const items = listing?.items ?? [];

    return <>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar
        actions={<Inline>
          <Button disabled={loading} on_click={ui.invalidate}>{loading ? "刷新中…" : "刷新"}</Button>
          <Button variant="primary" disabled={busy} on_click={() => { set_creating((value) => !value); set_draft(""); }}>{creating ? "取消" : "新建记忆"}</Button>
        </Inline>}
      />
      {creating ? <Section title="新建记忆" description={scope === "city" ? `写入「${scope_label}」范围。` : undefined}>
        <Field label="内容"><Textarea value={draft} rows={5} placeholder="要长期保留的事实、偏好或决策。" on_value_change={set_draft} /></Field>
        <Inline>
          <Button variant="primary" disabled={busy || !draft.trim()} on_click={() => void save()}>{busy ? "保存中…" : "保存"}</Button>
          {scope === "city" ? <Status>写入目标：{scope_label}</Status> : null}
        </Inline>
      </Section> : null}
      {!items.length ? <EmptyState
        title="还没有记忆"
        description="Agent 在会话中形成的长期记忆，或在这里新建的记忆都会出现在列表中。"
        size="compact"
      /> : <Section title={`记忆 · ${items.length}/${listing?.total ?? items.length}`} description={scope === "city" ? `范围：${scope_label}` : undefined}>
        <Group>{items.map((item) => <Row
          key={item.memory_id}
          label={item.title}
          description={`${type_label(item.memory_type)} · ${item.snippet}`}
          trailing={<ItemMenu label={`${item.title} 操作`} reveal_on_hover actions={[
            { action_id: "forget", label: "删除", destructive: true, on_select: () => forget(item) },
          ]} />}
          on_click={() => ui.open_view({ view_id: "memory_detail", resource_key: JSON.stringify([scope, agent_id, workspace_id, item.memory_id]), title: item.title || item.memory_id, input: { scope, agent_id, workspace_id, memory_id: item.memory_id } })}
        />)}</Group>
      </Section>}
    </>;
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
