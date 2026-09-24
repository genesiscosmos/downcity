/**
 * Skill Power 的功能工作区。
 *
 * Sidebar 是两个平级入口：全局目录（用户目录里可关联的 Skill）与各个 Agent。
 * Mainview 按入口分两种：全局页负责浏览用户目录并把 Skill 关联到某个 Agent；
 * Agent 页只展示该 Agent 已绑定的 Skill，并可移除。文件操作全部交给宿主 action。
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
    const { Callout, LoadingState, Sidebar, SidebarSection, SidebarItem, SidebarSubText } = ui.components;
    const [snapshot, set_snapshot] = useState<SkillMainviewSnapshot>();
    const [error, set_error] = useState("");
    /** 已经自动选过一次入口；避免用户切走后被反复拉回。 */
    const auto_selected_ref = useRef(false);
    const selected_agent_id = read_route(navigation.route.agent_id);
    const view = read_sidebar_view(navigation.route.agent_id);

    useEffect(() => {
      let disposed = false;
      set_error("");
      void power.invoke<SkillMainviewSnapshot>("skill.snapshot")
        .then((next) => { if (!disposed) set_snapshot(next); })
        .catch((reason) => { if (!disposed) set_error(to_error_message(reason)); });
      return () => { disposed = true; };
    }, [power, ui.revision]);

    useEffect(() => {
      if (!snapshot || auto_selected_ref.current) return;
      // 首次进入时给一个确定的落点：有 Agent 就选第一个，否则落在全局页。
      auto_selected_ref.current = true;
      if (selected_agent_id || snapshot.agents.length === 0) return;
      navigation.navigate(agent_route(snapshot.agents[0].agent_id));
    }, [navigation.navigate, selected_agent_id, snapshot]);

    if (!snapshot) return <Sidebar>{error
      ? <Callout tone="danger">{error}</Callout>
      : <LoadingState label="正在读取 Skills…" />}</Sidebar>;

    return <Sidebar>
      <SidebarSection label="Skills">
        <SidebarItem
          label="全局目录"
          trailing={snapshot.available.length}
          active={view === "global"}
          on_select={() => navigation.navigate({ view: "global" })}
        />
      </SidebarSection>
      <SidebarSection label="Agents">
        {snapshot.agents.map((agent) => <SidebarItem
          key={agent.agent_id}
          label={agent.name}
          trailing={agent.skills.length}
          active={selected_agent_id === agent.agent_id}
          on_select={() => navigation.navigate(agent_route(agent.agent_id))}
        />)}
        {!snapshot.agents.length ? <SidebarSubText>还没有 Agent</SidebarSubText> : null}
      </SidebarSection>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Sidebar>;
  },

  mainview: function SkillPowerMainview({ power, navigation, ui }) {
    const { Button, Callout, EmptyState, Group, Inline, Input, ItemMenu, LoadingState, Markdown, Page, Row, Section, Select, Status, Toolbar } = ui.components;
    const [snapshot, set_snapshot] = useState<SkillMainviewSnapshot>();
    const [loading, set_loading] = useState(true);
    const [content, set_content] = useState("");
    const [reading, set_reading] = useState(false);
    const [filter, set_filter] = useState("");
    const [target_agent_id, set_target_agent_id] = useState("");
    const [busy_key, set_busy_key] = useState("");
    const [error, set_error] = useState("");
    const agent_id = read_route(navigation.route.agent_id);
    const skill_id = read_route(navigation.route.skill_id);
    const view = read_sidebar_view(navigation.route.agent_id);

    const load_snapshot = useCallback(async () => {
      set_loading(true);
      set_error("");
      try {
        set_snapshot(await power.invoke<SkillMainviewSnapshot>("skill.snapshot"));
      } catch (reason) {
        set_error(to_error_message(reason));
      } finally {
        set_loading(false);
      }
    }, [power]);

    useEffect(() => { void load_snapshot(); }, [load_snapshot, ui.revision]);

    const agents = snapshot?.agents ?? [];
    const agent = agents.find((item) => item.agent_id === agent_id);
    const skills = agent?.skills ?? [];
    const selected_skill = skills.find((skill) => skill.id === skill_id);
    const available = snapshot?.available ?? [];
    const visible_available = useMemo(
      () => filter_by_name(available, filter),
      [available, filter],
    );
    const visible_skills = useMemo(() => filter_by_name(skills, filter), [filter, skills]);

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

    // 关联目标默认取当前 Agent；没有 Agent 时留空，界面据此禁用关联。
    useEffect(() => {
      if (target_agent_id && agents.some((item) => item.agent_id === target_agent_id)) return;
      set_target_agent_id(agents[0]?.agent_id ?? "");
    }, [agents, target_agent_id]);

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
      if (!target_agent_id) return;
      await run_mutation({
        action_id: "skill.link",
        payload: { agent_id: target_agent_id, skill_id: item.id },
        key: item.id,
        success_message: "Skill 已关联",
      });
    };

    const skill_menu = (skill: SkillMainviewItem) => <ItemMenu
      label={`${skill.name} 操作`}
      actions={[{ action_id: "remove", label: "移除", destructive: true, disabled: Boolean(busy_key), on_select: () => remove_skill(skill) }]}
    />;

    if (loading && !snapshot) return <LoadingState label="正在读取 Skills…" />;
    if (!snapshot) return <Page>{error
      ? <Callout tone="danger">{error}</Callout>
      : <EmptyState title="无法读取 Skills" description="请刷新后重试。" />}</Page>;

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

    if (view === "global") return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar
        title="全局目录"
        description={`~/.agents/skills · ${available.length} 个 Skill`}
        actions={<Button disabled={loading} on_click={ui.invalidate}>{loading ? "刷新中…" : "刷新"}</Button>}
      />
      {agents.length
        ? <Inline fill>
            <Select
              value={target_agent_id}
              options={agents.map((item) => ({ value: item.agent_id, label: item.name }))}
              on_value_change={set_target_agent_id}
            />
          </Inline>
        : <Callout>还没有 Agent，先创建一个再关联 Skill。</Callout>}
      <Input value={filter} placeholder="搜索" on_value_change={set_filter} />
      {!visible_available.length
        ? <EmptyState title={filter.trim() ? "没有匹配的 Skill" : "用户目录里没有 Skill"} description="把 Skill 放进 ~/.agents/skills 后即可在这里关联。" size="compact" />
        : <Group>{visible_available.map((item) => {
            const linked = item.linked_agent_ids.includes(target_agent_id);
            return <Row
              key={item.id}
              label={item.name}
              description={item.description || item.id}
              trailing={linked
                ? <Status tone="success">已关联</Status>
                : <Button disabled={Boolean(busy_key) || !target_agent_id} on_click={() => void link_skill(item)}>{busy_key === item.id ? "关联中…" : "关联"}</Button>}
            />;
          })}</Group>}
    </Page>;

    if (!agent) return <Page><EmptyState title="还没有 Agent" description="先在 Downcity 中创建一个 Agent。" /></Page>;

    return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar
        title={agent.name}
        description={`${skills.length} 个 Skill`}
        actions={<Button disabled={loading} on_click={ui.invalidate}>{loading ? "刷新中…" : "刷新"}</Button>}
      />
      <Input value={filter} placeholder="搜索" on_value_change={set_filter} />
      {!visible_skills.length
        ? <EmptyState
            title={filter.trim() ? "没有匹配的 Skill" : "还没有 Skill"}
            description="到「全局目录」里关联。"
            size="compact"
          />
        : <Group>{visible_skills.map((skill) => <Row
            key={skill.id}
            label={skill.name}
            description={skill.description || skill.id}
            trailing={skill_menu(skill)}
            on_click={() => navigation.navigate(agent_route(agent.agent_id, skill.id))}
          />)}</Group>}
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

/** 判断当前选中入口：有 agent_id 就是 Agent 页，否则是全局页。 */
function read_sidebar_view(value: unknown): "global" | "agent" {
  return typeof value === "string" && value ? "agent" : "global";
}

/** 从宿主 JSON route 中读取一个可选字符串。 */
function read_route(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 把未知失败转换为用户可见消息。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
