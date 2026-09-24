/**
 * Skill Power 的功能工作区。
 *
 * Sidebar 以宿主登记的全部 Agent 为树根，展开后直接显示该 Agent 已绑定的 Skill。
 * Mainview 是单个 Agent 的 Skill 页：两个视图——已绑定、添加（从用户目录关联）。
 * 文件操作全部交给宿主 action。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { define_power_renderer } from "@downcity/city/power/react";
import type { PowerJsonObject } from "@downcity/city/power";
import type {
  SkillMainviewAvailableItem,
  SkillMainviewItem,
  SkillMainviewMutationResult,
  SkillMainviewReadResult,
  SkillMainviewSnapshot,
} from "@/skill/types/SkillMainview.js";

/** Skill Power Renderer 定义。 */
export const SKILL_POWER_RENDERER = define_power_renderer({
  sidebar: function SkillPowerSidebar({ power, navigation, ui }) {
    const { Callout, LoadingState, Sidebar, SidebarSection, SidebarSubText, SidebarTreeItem } = ui.components;
    const [snapshot, set_snapshot] = useState<SkillMainviewSnapshot>();
    const [expanded_agent_ids, set_expanded_agent_ids] = useState<Set<string>>(new Set());
    const [error, set_error] = useState("");
    /** 已经自动展开过的 Agent；见下面那个 effect 的说明。 */
    const auto_expanded_ref = useRef("");
    const selected_agent_id = read_route(navigation.route.agent_id);
    const selected_skill_id = read_route(navigation.route.skill_id);

    useEffect(() => {
      let disposed = false;
      set_error("");
      void power.invoke<SkillMainviewSnapshot>("skill.snapshot")
        .then((next) => {
          if (disposed) return;
          set_snapshot(next);
          set_expanded_agent_ids((current) => new Set(
            [...current].filter((agent_id) => next.agents.some((agent) => agent.agent_id === agent_id)),
          ));
        })
        .catch((reason) => { if (!disposed) set_error(to_error_message(reason)); });
      return () => { disposed = true; };
    }, [power, ui.revision]);

    useEffect(() => {
      if (!snapshot) return;
      const next_agent_id = snapshot.agents.some((agent) => agent.agent_id === selected_agent_id)
        ? selected_agent_id
        : snapshot.agents[0]?.agent_id ?? "";
      if (next_agent_id !== selected_agent_id) {
        navigation.navigate(next_agent_id ? agent_route(next_agent_id) : {});
        return;
      }
      if (!next_agent_id) return;
      // 只在**选中项变化时**自动展开一次。展开是“跟随选中”的一次性动作，
      // 不是一个持续成立的不变量：用户有权收起自己正在看的那一项。
      if (auto_expanded_ref.current === next_agent_id) return;
      auto_expanded_ref.current = next_agent_id;
      set_expanded_agent_ids((current) => current.has(next_agent_id) ? current : new Set(current).add(next_agent_id));
    }, [navigation.navigate, selected_agent_id, snapshot]);

    if (!snapshot) return <Sidebar>{error
      ? <Callout tone="danger">{error}</Callout>
      : <LoadingState label="正在读取 Skills…" />}</Sidebar>;

    return <Sidebar>
      <SidebarSection label="Agents">
        {snapshot.agents.map((agent) => {
          const expanded = expanded_agent_ids.has(agent.agent_id);
          return <div key={agent.agent_id}>
            <SidebarTreeItem
              depth={0}
              kind="branch"
              label={agent.name}
              trailing={agent.skills.length}
              active={selected_agent_id === agent.agent_id && !selected_skill_id}
              expanded={expanded}
              on_toggle={() => set_expanded_agent_ids((current) => toggle_key(current, agent.agent_id))}
              on_select={() => navigation.navigate(agent_route(agent.agent_id))}
            />
            {expanded ? <div className="flex flex-col gap-0.5">{agent.skills.map((skill) => <SidebarTreeItem
              key={`${agent.agent_id}:${skill.id}`}
              kind="leaf"
              depth={1}
              label={skill.name}
              active={selected_agent_id === agent.agent_id && selected_skill_id === skill.id}
              on_select={() => navigation.navigate(agent_route(agent.agent_id, skill.id))}
            />)}</div> : null}
            {expanded && agent.skills.length === 0 ? <SidebarSubText indent={1}>暂无 Skill</SidebarSubText> : null}
          </div>;
        })}
        {!snapshot.agents.length ? <SidebarSubText>还没有 Agent</SidebarSubText> : null}
      </SidebarSection>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Sidebar>;
  },

  mainview: function SkillPowerMainview({ power, navigation, ui }) {
    const { Button, Callout, EmptyState, Group, Input, ItemMenu, LoadingState, Markdown, Page, Row, Section, Status, Tabs, Toolbar } = ui.components;
    const [snapshot, set_snapshot] = useState<SkillMainviewSnapshot>();
    const [loading, set_loading] = useState(true);
    const [content, set_content] = useState("");
    const [reading, set_reading] = useState(false);
    const [filter, set_filter] = useState("");
    const [busy_key, set_busy_key] = useState("");
    const [error, set_error] = useState("");
    const agent_id = read_route(navigation.route.agent_id);
    const skill_id = read_route(navigation.route.skill_id);
    const tab = read_tab(navigation.route.tab);

    const load_snapshot = useCallback(async () => {
      set_loading(true);
      set_error("");
      try {
        set_snapshot(await power.invoke<SkillMainviewSnapshot>("skill.snapshot", { agent_id }));
      } catch (reason) {
        set_error(to_error_message(reason));
      } finally {
        set_loading(false);
      }
    }, [agent_id, power]);

    useEffect(() => { void load_snapshot(); }, [load_snapshot, ui.revision]);

    const agent = snapshot?.agents.find((item) => item.agent_id === agent_id) ?? snapshot?.agents[0];
    const skills = agent?.skills ?? [];
    const selected_skill = skills.find((skill) => skill.id === skill_id);
    const visible_skills = useMemo(() => filter_by_name(skills, filter), [filter, skills]);
    const visible_available = useMemo(
      () => filter_by_name(snapshot?.available ?? [], filter),
      [filter, snapshot],
    );

    useEffect(() => {
      if (!selected_skill || !agent) {
        set_content("");
        set_reading(false);
        return;
      }
      let disposed = false;
      set_content("");
      set_reading(true);
      void power.invoke<SkillMainviewReadResult>("skill.read", {
        agent_id: agent.agent_id,
        skill_id: selected_skill.id,
      })
        .then((result) => { if (!disposed) set_content(result.success ? result.content ?? "" : result.error ?? "读取 Skill 失败"); })
        .catch((reason) => { if (!disposed) set_content(to_error_message(reason)); })
        .finally(() => { if (!disposed) set_reading(false); });
      return () => { disposed = true; };
    }, [agent, power, selected_skill?.id, ui.revision]);

    const run_mutation = async (input: {
      action_id: string;
      payload: PowerJsonObject;
      key: string;
      success_message: string;
    }) => {
      set_busy_key(input.key);
      set_error("");
      try {
        const result = await power.invoke<SkillMainviewMutationResult>(input.action_id, input.payload);
        set_snapshot(result);
        if (!result.operation_success) throw new Error(result.error || "操作失败");
        if (skill_id) navigation.navigate(agent_route(agent_id));
        ui.invalidate();
        ui.toast({ type: "success", message: input.success_message });
      } catch (reason) {
        const message = to_error_message(reason);
        set_error(message);
        ui.toast({ type: "error", message });
      } finally {
        set_busy_key("");
      }
    };

    const remove_skill = async (skill: SkillMainviewItem) => {
      if (!agent) return;
      const confirmed = await ui.confirm({
        title: `移除 ${skill.name}？`,
        description: skill.is_link
          ? "只删除该 Agent 目录中的关联，用户目录不受影响。"
          : "该 Skill 会从当前 Agent 目录永久删除。",
        action: "移除",
        destructive: true,
      });
      if (!confirmed) return;
      await run_mutation({
        action_id: "skill.remove",
        payload: { agent_id: agent.agent_id, skill_id: skill.id },
        key: skill.id,
        success_message: "Skill 已移除",
      });
    };

    const link_skill = async (item: SkillMainviewAvailableItem) => {
      if (!agent) return;
      await run_mutation({
        action_id: "skill.link",
        payload: { agent_id: agent.agent_id, skill_id: item.id },
        key: item.id,
        success_message: "Skill 已关联",
      });
    };

    const skill_menu = (skill: SkillMainviewItem, reveal_on_hover = false) => <ItemMenu
      label={`${skill.name} 操作`}
      reveal_on_hover={reveal_on_hover}
      actions={[{ action_id: "remove", label: "移除", destructive: true, disabled: Boolean(busy_key), on_select: () => remove_skill(skill) }]}
    />;

    if (loading && !snapshot) return <LoadingState label="正在读取 Skills…" />;
    if (!snapshot) return <Page>{error
      ? <Callout tone="danger">{error}</Callout>
      : <EmptyState title="无法读取 Skills" description="请刷新后重试。" />}</Page>;
    if (!snapshot.agents.length) return <Page><EmptyState title="还没有 Agent" description="先在 Downcity 中创建一个 Agent。" /></Page>;

    if (selected_skill && agent) return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar
        title={selected_skill.name}
        description={selected_skill.description || selected_skill.id}
        actions={skill_menu(selected_skill)}
      />
      <Section title="SKILL.md">{reading
        ? <LoadingState label="正在读取 Skill…" />
        : content ? <Markdown text={content} /> : <EmptyState title="Skill 内容为空" size="compact" />}</Section>
    </Page>;

    return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar
        title={agent?.name ?? ""}
        description={`${skills.length} 个 Skill`}
        actions={<Button disabled={loading} on_click={ui.invalidate}>{loading ? "刷新中…" : "刷新"}</Button>}
      />
      <Tabs
        label="Skill 视图"
        value={tab}
        on_value_change={(value) => navigation.navigate({ ...agent_route(agent?.agent_id ?? ""), tab: value })}
        items={[
          { value: "bound", label: "已绑定", count: skills.length },
          { value: "add", label: "添加", count: visible_available.filter((item) => !item.linked).length },
        ]}
      />
      {tab === "add" ? <Section>
        <Input value={filter} placeholder="搜索用户目录" on_value_change={set_filter} />
        {!visible_available.length
          ? <EmptyState title={filter.trim() ? "没有匹配的 Skill" : "用户目录里没有 Skill"} description="把 Skill 放进 ~/.agents/skills 后即可在这里关联。" size="compact" />
          : <Group>{visible_available.map((item) => <Row
              key={item.id}
              label={item.name}
              description={item.description || item.id}
              trailing={item.linked
                ? <Status tone="success">已关联</Status>
                : <Button disabled={Boolean(busy_key)} on_click={() => void link_skill(item)}>{busy_key === item.id ? "关联中…" : "关联"}</Button>}
            />)}</Group>}
      </Section> : null}
      {tab === "bound" ? <Section>
        <Input value={filter} placeholder="搜索已绑定 Skill" on_value_change={set_filter} />
        {!visible_skills.length
          ? <EmptyState
              title={filter.trim() ? "没有匹配的 Skill" : "还没有 Skill"}
              description="到「添加」里从用户目录关联。"
              size="compact"
            />
          : <Group>{visible_skills.map((skill) => <Row
              key={skill.id}
              label={skill.name}
              description={skill.description || skill.id}
              trailing={skill_menu(skill, true)}
              on_click={() => navigation.navigate(agent_route(agent?.agent_id ?? "", skill.id))}
            />)}</Group>}
      </Section> : null}
    </Page>;
  },
});

/** 创建 Agent 范围的稳定 Power route。 */
function agent_route(agent_id: string, skill_id?: string) {
  return { agent_id, ...(skill_id ? { skill_id } : {}) };
}

/** 按名称与 ID 筛选条目。 */
function filter_by_name<T extends { name: string; id: string; description: string }>(
  items: T[],
  filter: string,
): T[] {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) return items;
  return items.filter((item) => `${item.name} ${item.id} ${item.description}`.toLowerCase().includes(normalized));
}

/** 切换集合中的一个键，并返回新的不可变集合。 */
function toggle_key(current: Set<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** 从宿主 JSON route 读取当前 Tab，未知值回退到已绑定。 */
function read_tab(value: unknown): "bound" | "add" {
  return value === "add" ? "add" : "bound";
}

/** 从宿主 JSON route 中读取一个可选字符串。 */
function read_route(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 把未知失败转换为用户可见消息。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
