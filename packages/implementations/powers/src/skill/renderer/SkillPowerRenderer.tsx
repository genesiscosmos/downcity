/**
 * Skill Power 的功能工作区。
 *
 * Sidebar 以宿主登记的全部 Agent 为树根，展开后直接显示该 Agent 已绑定的 Skill。
 * Mainview 是单个 Agent 的 Skill 配置页：展示已绑定列表、全局目录、关联/取消关联，
 * 以及公开目录搜索与安装。文件与网络操作全部交给宿主 action。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { define_power_renderer } from "@downcity/city/power/react";
import type { PowerJsonObject } from "@downcity/city/power";
import type {
  SkillMainviewAgent,
  SkillMainviewCatalogItem,
  SkillMainviewItem,
  SkillMainviewMutationResult,
  SkillMainviewReadResult,
  SkillMainviewSearchHit,
  SkillMainviewSearchResult,
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
            {expanded && agent.skills.length === 0 ? <SidebarSubText indent={1}>{agent.directory} 下还没有 Skill</SidebarSubText> : null}
          </div>;
        })}
        {!snapshot.agents.length ? <SidebarSubText>还没有 Agent</SidebarSubText> : null}
      </SidebarSection>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Sidebar>;
  },

  mainview: function SkillPowerMainview({ power, navigation, ui }) {
    const { Button, Callout, EmptyState, Group, Inline, Input, ItemMenu, LoadingState, Markdown, Page, Row, Section, Stack, Status, Tabs, Toolbar } = ui.components;
    const [snapshot, set_snapshot] = useState<SkillMainviewSnapshot>();
    const [loading, set_loading] = useState(true);
    const [content, set_content] = useState("");
    const [reading, set_reading] = useState(false);
    const [filter, set_filter] = useState("");
    const [query, set_query] = useState("");
    const [hits, set_hits] = useState<SkillMainviewSearchHit[]>([]);
    const [searching, set_searching] = useState(false);
    const [busy_key, set_busy_key] = useState("");
    const [error, set_error] = useState("");
    const agent_id = read_route(navigation.route.agent_id);
    const skill_id = read_route(navigation.route.skill_id);
    const tab = read_tab(navigation.route.tab);

    const load_snapshot = useCallback(async () => {
      set_loading(true);
      set_error("");
      try {
        set_snapshot(await power.invoke<SkillMainviewSnapshot>("skill.catalog", { agent_id }));
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
    const visible_skills = useMemo(
      () => filter_skills(skills, filter),
      [filter, skills],
    );
    const visible_catalog = useMemo(
      () => filter_catalog(snapshot?.catalog ?? [], filter),
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
        scope: "agent",
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
          ? "只会删除该 Agent 目录中的关联，外部来源目录不受影响。"
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

    const link_skill = async (item: SkillMainviewCatalogItem) => {
      if (!agent) return;
      await run_mutation({
        action_id: "skill.link",
        payload: {
          agent_id: agent.agent_id,
          skill_id: item.id,
          scope: item.origin.source,
          ...(item.origin.workspace_id ? { workspace_id: item.origin.workspace_id } : {}),
        },
        key: link_key(item),
        success_message: "Skill 已关联",
      });
    };

    const skill_menu = (skill: SkillMainviewItem, reveal_on_hover = false) => <ItemMenu
      label={`${skill.name} 操作`}
      reveal_on_hover={reveal_on_hover}
      actions={[{ action_id: "remove", label: "移除", destructive: true, disabled: Boolean(busy_key), on_select: () => remove_skill(skill) }]}
    />;

    const search = async () => {
      const normalized_query = query.trim();
      if (!normalized_query) return;
      set_searching(true);
      set_error("");
      try {
        const result = await power.invoke<SkillMainviewSearchResult>("skill.search", { query: normalized_query });
        if (!result.success) throw new Error(result.error || "搜索 Skill 失败");
        set_hits(result.hits);
      } catch (reason) {
        set_error(to_error_message(reason));
      } finally {
        set_searching(false);
      }
    };

    const install = async (hit: SkillMainviewSearchHit) => {
      if (!agent) return;
      await run_mutation({
        action_id: "skill.install",
        payload: { agent_id: agent.agent_id, spec: hit.spec },
        key: `install:${hit.spec}`,
        success_message: "Skill 已安装",
      });
    };

    if (loading && !snapshot) return <LoadingState label="正在读取 Skills…" />;
    if (!snapshot) return <Page>{error
      ? <Callout tone="danger">{error}</Callout>
      : <EmptyState title="无法读取 Skills" description="请刷新后重试。" />}</Page>;
    if (!snapshot.agents.length) return <Page><EmptyState title="还没有 Agent" description="先在 Downcity 中创建一个 Agent。" /></Page>;

    if (selected_skill && agent) return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar
        title={selected_skill.name}
        description={`${agent.name} · ${selected_skill.id}`}
        actions={<Inline><Button on_click={() => navigation.navigate(agent_route(agent.agent_id))}>返回列表</Button>{skill_menu(selected_skill)}</Inline>}
      />
      <Group>
        <Row label="Agent" trailing={<Status>{agent.name}</Status>} />
        <Row label="Skill ID" trailing={<Status>{selected_skill.id}</Status>} />
        <Row label="来源" trailing={<Status tone="muted">{skill_source_label(selected_skill)}</Status>} />
        {selected_skill.link_target ? <Row label="链接目标" trailing={<Status tone="muted">{selected_skill.link_target}</Status>} /> : null}
        <Row label="Allowed tools" trailing={<Status>{selected_skill.allowed_tools.length ? selected_skill.allowed_tools.join(", ") : "未限制"}</Status>} />
      </Group>
      <Section title="SKILL.md">{reading
        ? <LoadingState label="正在读取 Skill…" />
        : content ? <Markdown text={content} /> : <EmptyState title="Skill 内容为空" size="compact" />}</Section>
    </Page>;

    return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar
        title={`${agent?.name ?? ""} 的 Skills`}
        description={`${skills.length} 个已绑定 Skill`}
        actions={<Button disabled={loading} on_click={ui.invalidate}>{loading ? "刷新中…" : "刷新"}</Button>}
      />
      <Tabs
        label="Skill 视图"
        value={tab}
        on_value_change={(value) => navigation.navigate({ ...agent_route(agent?.agent_id ?? ""), tab: value })}
        items={[
          { value: "bound", label: "已绑定", count: skills.length },
          { value: "catalog", label: "全局目录", count: snapshot.catalog?.length ?? 0 },
          { value: "discover", label: "发现" },
        ]}
      />
      {tab === "discover" ? <Section title="发现 Skills" description={`从公开目录搜索并安装到 ${agent?.directory ?? "该 Agent 的技能目录"}。安装后这个 Agent 就能直接用。`}>
        <Inline fill>
          <Input value={query} placeholder="搜索 skills.sh" on_value_change={set_query} />
          <Button disabled={searching || !query.trim()} on_click={() => void search()}>{searching ? "搜索中…" : "搜索"}</Button>
        </Inline>
        {!hits.length
          ? <EmptyState title="搜索并发现新的 Skill" description="输入能力关键词，例如 browser、slides 或 research。" size="compact" />
          : <Group>{hits.map((hit) => <Row
              key={hit.spec}
              label={hit.skill || hit.spec}
              description={hit.spec}
              trailing={<Button variant="primary" disabled={Boolean(busy_key)} on_click={() => void install(hit)}>{busy_key === `install:${hit.spec}` ? "安装中…" : "安装"}</Button>}
            />)}</Group>}
      </Section> : null}
      {tab === "catalog" ? <Section title="全局目录" description={`按来源分组：用户目录与各 Workspace 的 .agents/skills。关联会在 ${agent?.directory ?? "该 Agent 的技能目录"} 下建软链接，来源目录不受影响。`}>
        <Input value={filter} placeholder="筛选 Skill" on_value_change={set_filter} />
        {!visible_catalog.length
          ? <EmptyState title={filter.trim() ? "没有匹配的 Skill" : "全局目录为空"} description="可以先在「发现」里安装，或把 Skill 放进 Workspace 的 .agents/skills。" size="compact" />
          : <Stack>{group_catalog(visible_catalog).map((group) => <Group key={group.key} label={group.label} count={group.items.length} collapsible default_expanded>
              {group.items.map((item) => <Row
                key={catalog_key(item)}
                label={item.name}
                description={item.description || item.id}
                trailing={item.linked
                  ? <Status tone="success">已关联</Status>
                  : <Button disabled={Boolean(busy_key)} on_click={() => void link_skill(item)}>{busy_key === link_key(item) ? "关联中…" : "关联"}</Button>}
              />)}
            </Group>)}</Stack>}
      </Section> : null}
      {tab === "bound" ? <Section title="已绑定 Skills" description={`${agent?.directory ?? "该 Agent 的技能目录"} 中的全部 Skill，也是它默认可用的集合。`}>
        <Input value={filter} placeholder="筛选已绑定 Skills" on_value_change={set_filter} />
        {!visible_skills.length
          ? <EmptyState
              title={filter.trim() ? "没有匹配的 Skill" : "还没有 Skill"}
              description="从「全局目录」关联，或在「发现」里安装。"
              size="compact"
            />
          : <Group>{visible_skills.map((skill) => <Row
              key={skill.id}
              label={skill.name}
              description={`${skill_source_label(skill)} · ${skill.description || skill.id}`}
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

/** 按关键词筛选已绑定 Skill。 */
function filter_skills(skills: SkillMainviewItem[], filter: string): SkillMainviewItem[] {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) return skills;
  return skills.filter((skill) => `${skill.name} ${skill.id} ${skill.description}`.toLowerCase().includes(normalized));
}

/** 按关键词筛选全局目录。 */
function filter_catalog(catalog: SkillMainviewCatalogItem[], filter: string): SkillMainviewCatalogItem[] {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) return catalog;
  return catalog.filter((item) => `${item.name} ${item.id} ${item.description}`.toLowerCase().includes(normalized));
}

/** 构造全局目录条目的唯一键。 */
function catalog_key(item: SkillMainviewCatalogItem): string {
  return `${item.origin.source}:${item.origin.workspace_id ?? "home"}:${item.id}`;
}

/** 构造一条关联操作的忙态键。 */
function link_key(item: SkillMainviewCatalogItem): string {
  return `link:${catalog_key(item)}`;
}

/** 描述一条 Skill 的当前来源，用于已绑定列表与详情页。 */
function skill_source_label(skill: SkillMainviewItem): string {
  if (!skill.is_link) return "已安装到该 Agent 目录";
  if (!skill.origin) return "已关联";
  return skill.origin.source === "home"
    ? "已关联 · 用户目录"
    : `已关联 · ${skill.origin.workspace_name ?? skill.origin.workspace_id ?? "Workspace"}`;
}

/** 全局目录按来源分组后的一组条目。 */
interface CatalogGroup {
  /** 分组稳定键，用于渲染 key。 */
  key: string;
  /** 分组标题。 */
  label: string;
  /** 该组内的 Skill。 */
  items: SkillMainviewCatalogItem[];
}

/**
 * 把全局目录按来源分组。
 *
 * 关键点（中文）：用户目录一组，每个 Workspace 各自一组；project 与 home 不能在
 * 同一个平铺列表里混着展示，否则用户无法判断一条 Skill 到底来自哪里。
 */
function group_catalog(catalog: SkillMainviewCatalogItem[]): CatalogGroup[] {
  const groups = new Map<string, CatalogGroup>();
  for (const item of catalog) {
    const is_home = item.origin.source === "home";
    const key = is_home ? "home" : `project:${item.origin.workspace_id ?? ""}`;
    const label = is_home
      ? "用户目录 · ~/.agents/skills"
      : `Workspace · ${item.origin.workspace_name ?? item.origin.workspace_id ?? ""}`;
    const existing = groups.get(key);
    if (existing) existing.items.push(item);
    else groups.set(key, { key, label, items: [item] });
  }
  return [...groups.values()];
}

/** 切换集合中的一个键，并返回新的不可变集合。 */
function toggle_key(current: Set<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** 从宿主 JSON route 读取当前 Tab，未知值回退到已绑定。 */
function read_tab(value: unknown): "bound" | "catalog" | "discover" {
  return value === "catalog" || value === "discover" ? value : "bound";
}

/** 从宿主 JSON route 中读取一个可选字符串。 */
function read_route(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 把未知失败转换为用户可见消息。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
