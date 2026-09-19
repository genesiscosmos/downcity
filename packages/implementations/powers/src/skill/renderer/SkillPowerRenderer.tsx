/**
 * Skill Power 的功能工作区。
 *
 * Sidebar 以所有 Workspace 和个人目录为树根，只负责展开与业务选择；Mainview 根据共享
 * route 在集合、详情和发现页面之间互斥切换。文件与网络操作全部交给宿主 action。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { define_power_renderer } from "@downcity/city/power/react";
import type {
  SkillMainviewItem,
  SkillMainviewMutationResult,
  SkillMainviewReadResult,
  SkillMainviewScope,
  SkillMainviewSearchHit,
  SkillMainviewSearchResult,
  SkillMainviewSnapshot,
} from "@/skill/types/SkillMainview.js";

/** Skill Power Renderer 定义。 */
export const SKILL_POWER_RENDERER = define_power_renderer({
  sidebar: function SkillPowerSidebar({ power, navigation, ui }) {
    const { Callout, ItemMenu, LoadingState, Sidebar, SidebarItem, SidebarSection, SidebarSubText, SidebarTreeItem } = ui.components;
    const [snapshot, set_snapshot] = useState<SkillMainviewSnapshot>();
    const [expanded_workspace_ids, set_expanded_workspace_ids] = useState<Set<string>>(new Set());
    const [personal_expanded, set_personal_expanded] = useState(false);
    const [error, set_error] = useState("");
    const auto_expanded_route_key = useRef("");
    const scope = read_scope(navigation.route.scope);
    const selected_workspace_id = read_route(navigation.route.workspace_id);
    const selected_skill_id = read_route(navigation.route.skill_id);

    useEffect(() => {
      let disposed = false;
      set_error("");
      void power.invoke<SkillMainviewSnapshot>("skills.list")
        .then((next) => {
          if (disposed) return;
          set_snapshot(next);
          set_expanded_workspace_ids((current) => new Set([...current].filter((workspace_id) => next.workspaces.some((workspace) => workspace.workspace_id === workspace_id))));
        })
        .catch((reason) => { if (!disposed) set_error(to_error_message(reason)); });
      return () => { disposed = true; };
    }, [power, ui.revision]);

    useEffect(() => {
      if (!snapshot) return;
      const route_key = `${scope}:${selected_workspace_id}:${selected_skill_id}`;
      const should_auto_expand = auto_expanded_route_key.current !== route_key;
      auto_expanded_route_key.current = route_key;
      if (scope === "home") {
        if (should_auto_expand) set_personal_expanded(true);
        if (selected_skill_id && !snapshot.home_skills.some((skill) => skill.id === selected_skill_id)) navigation.navigate({ scope: "home" });
        return;
      }
      if (scope !== "workspace") return;
      const workspace = snapshot.workspaces.find((item) => item.workspace_id === selected_workspace_id);
      if (!workspace) {
        const first_workspace = snapshot.workspaces[0];
        if (first_workspace) navigation.navigate(workspace_route(first_workspace.workspace_id));
        return;
      }
      if (should_auto_expand) set_expanded_workspace_ids((current) => current.has(workspace.workspace_id) ? current : new Set(current).add(workspace.workspace_id));
      if (selected_skill_id && !workspace.skills.some((skill) => skill.id === selected_skill_id)) navigation.navigate(workspace_route(workspace.workspace_id));
    }, [navigation.navigate, scope, selected_skill_id, selected_workspace_id, snapshot]);

    const remove_skill = async (skill: SkillMainviewItem) => {
      const confirmed = await ui.confirm({ title: `删除 ${skill.name}？`, description: "对应 Skill 目录会从当前范围永久删除。", action: "删除", destructive: true });
      if (!confirmed) return;
      try {
        const result = await power.invoke<SkillMainviewMutationResult>("skills.remove", skill_input(skill));
        if (!result.operation_success) throw new Error(result.error || "删除 Skill 失败");
        set_snapshot(result);
        if (selected_skill_id === skill.id && selected_scope_matches(skill, scope, selected_workspace_id)) navigation.navigate(skill.scope === "workspace" ? workspace_route(skill.workspace_id ?? "") : { scope: "home" });
        ui.invalidate();
        ui.toast({ type: "success", message: "Skill 已删除" });
      } catch (reason) {
        const message = to_error_message(reason);
        set_error(message);
        ui.toast({ type: "error", message });
      }
    };

    const skill_menu = (skill: SkillMainviewItem) => <ItemMenu label={`${skill.name} 操作`} reveal_on_hover actions={[{ action_id: "remove", label: "删除", destructive: true, on_select: () => remove_skill(skill) }]} />;

    if (!snapshot) return <Sidebar>{error
      ? <Callout tone="danger">{error}</Callout>
      : <LoadingState label="正在读取 Skills…" />}</Sidebar>;

    return <Sidebar>
      <SidebarSection label="Workspaces">
        {snapshot?.workspaces.map((workspace) => {
          const expanded = expanded_workspace_ids.has(workspace.workspace_id);
          return <div key={workspace.workspace_id}>
            <SidebarTreeItem depth={0} kind="branch" label={workspace.name} trailing={workspace.skills.length} active={scope === "workspace" && selected_workspace_id === workspace.workspace_id && !selected_skill_id} expanded={expanded} on_toggle={() => set_expanded_workspace_ids((current) => toggle_key(current, workspace.workspace_id))} on_select={() => navigation.navigate(workspace_route(workspace.workspace_id))} />
            {expanded ? <div className="flex flex-col gap-0.5">{workspace.skills.map((skill) => <SidebarTreeItem key={skill.id} kind="leaf" depth={1} label={skill.name} trailing={skill_menu(skill)} active={scope === "workspace" && selected_workspace_id === workspace.workspace_id && selected_skill_id === skill.id} on_select={() => navigation.navigate(workspace_route(workspace.workspace_id, skill.id))} />)}</div> : null}
            {expanded && workspace.skills.length === 0 ? <SidebarSubText indent={1}>没有已安装的 Skill</SidebarSubText> : null}
          </div>;
        })}
        {!snapshot.workspaces.length ? <SidebarSubText>还没有 Workspace</SidebarSubText> : null}
      </SidebarSection>
      <SidebarSection label="Personal">
        <SidebarTreeItem depth={0} kind="branch" label="Personal Skills" trailing={snapshot.home_skills.length} active={scope === "home" && !selected_skill_id} expanded={personal_expanded} on_toggle={() => set_personal_expanded((current) => !current)} on_select={() => navigation.navigate({ scope: "home" })} />
        {personal_expanded ? <div className="flex flex-col gap-0.5">{snapshot.home_skills.map((skill) => <SidebarTreeItem key={skill.id} kind="leaf" depth={1} label={skill.name} trailing={skill_menu(skill)} active={scope === "home" && selected_skill_id === skill.id} on_select={() => navigation.navigate({ scope: "home", skill_id: skill.id })} />)}</div> : null}
        {personal_expanded && snapshot.home_skills.length === 0 ? <SidebarSubText indent={1}>没有已安装的 Skill</SidebarSubText> : null}
      </SidebarSection>
      <SidebarSection label="Discover"><SidebarItem label="发现 Skills" active={scope === "discover"} on_select={() => navigation.navigate({ scope: "discover" })} /></SidebarSection>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </Sidebar>;
  },

  mainview: function SkillPowerMainview({ power, navigation, ui }) {
    const { Button, Callout, EmptyState, Group, Inline, Input, ItemMenu, LoadingState, Markdown, Page, Row, Section, Select, Status, Toolbar } = ui.components;
    const [snapshot, set_snapshot] = useState<SkillMainviewSnapshot>();
    const [filter, set_filter] = useState("");
    const [query, set_query] = useState("");
    const [hits, set_hits] = useState<SkillMainviewSearchHit[]>([]);
    const [install_target, set_install_target] = useState("home");
    const [content, set_content] = useState("");
    const [loading, set_loading] = useState(true);
    const [reading, set_reading] = useState(false);
    const [searching, set_searching] = useState(false);
    const [busy_spec, set_busy_spec] = useState("");
    const [error, set_error] = useState("");
    const scope = read_scope(navigation.route.scope);
    const workspace_id = read_route(navigation.route.workspace_id);
    const skill_id = read_route(navigation.route.skill_id);

    const load_snapshot = useCallback(async () => {
      set_loading(true);
      set_error("");
      try {
        const next = await power.invoke<SkillMainviewSnapshot>("skills.list");
        set_snapshot(next);
        set_install_target((current) => current === "home" || next.workspaces.some((workspace) => workspace.workspace_id === current) ? current : next.workspaces[0]?.workspace_id ?? "home");
      } catch (reason) {
        set_error(to_error_message(reason));
      } finally {
        set_loading(false);
      }
    }, [power]);

    useEffect(() => { void load_snapshot(); }, [load_snapshot, ui.revision]);
    const workspace = snapshot?.workspaces.find((item) => item.workspace_id === workspace_id) ?? snapshot?.workspaces[0];
    const skills = scope === "workspace" ? workspace?.skills ?? [] : snapshot?.home_skills ?? [];
    const selected_skill = skills.find((skill) => skill.id === skill_id);
    const visible_skills = useMemo(() => {
      const normalized_filter = filter.trim().toLowerCase();
      return normalized_filter ? skills.filter((skill) => `${skill.name} ${skill.id} ${skill.description}`.toLowerCase().includes(normalized_filter)) : skills;
    }, [filter, skills]);

    useEffect(() => {
      if (!selected_skill) {
        set_content("");
        set_reading(false);
        return;
      }
      let disposed = false;
      set_content("");
      set_reading(true);
      void power.invoke<SkillMainviewReadResult>("skills.read", skill_input(selected_skill))
        .then((result) => { if (!disposed) set_content(result.success ? result.content ?? "" : result.error ?? "读取 Skill 失败"); })
        .catch((reason) => { if (!disposed) set_content(to_error_message(reason)); })
        .finally(() => { if (!disposed) set_reading(false); });
      return () => { disposed = true; };
    }, [power, selected_skill ? skill_key(selected_skill) : "", ui.revision]);

    const select_skill = (skill: SkillMainviewItem) => navigation.navigate(skill.scope === "workspace" ? workspace_route(skill.workspace_id ?? "", skill.id) : { scope: "home", skill_id: skill.id });
    const remove_skill = async (skill: SkillMainviewItem) => {
      const confirmed = await ui.confirm({ title: `删除 ${skill.name}？`, description: "对应 Skill 目录会从当前范围永久删除。", action: "删除", destructive: true });
      if (!confirmed) return;
      set_error("");
      try {
        const result = await power.invoke<SkillMainviewMutationResult>("skills.remove", skill_input(skill));
        if (!result.operation_success) throw new Error(result.error || "删除 Skill 失败");
        set_snapshot(result);
        if (selected_skill?.id === skill.id) navigation.navigate(skill.scope === "workspace" ? workspace_route(skill.workspace_id ?? "") : { scope: "home" });
        ui.invalidate();
        ui.toast({ type: "success", message: "Skill 已删除" });
      } catch (reason) {
        const message = to_error_message(reason);
        set_error(message);
        ui.toast({ type: "error", message });
      }
    };
    const skill_menu = (skill: SkillMainviewItem, reveal_on_hover = false) => <ItemMenu label={`${skill.name} 操作`} reveal_on_hover={reveal_on_hover} actions={[{ action_id: "remove", label: "删除", destructive: true, on_select: () => remove_skill(skill) }]} />;

    const search = async () => {
      const normalized_query = query.trim();
      if (!normalized_query) return;
      set_searching(true);
      set_error("");
      try {
        const result = await power.invoke<SkillMainviewSearchResult>("skills.find", { query: normalized_query });
        if (!result.success) throw new Error(result.error || "搜索 Skill 失败");
        set_hits(result.hits);
      } catch (reason) {
        set_error(to_error_message(reason));
      } finally {
        set_searching(false);
      }
    };

    const install = async (hit: SkillMainviewSearchHit) => {
      const target_scope: SkillMainviewScope = install_target === "home" ? "home" : "workspace";
      set_busy_spec(hit.spec);
      set_error("");
      try {
        const result = await power.invoke<SkillMainviewMutationResult>("skills.install", { scope: target_scope, spec: hit.spec, ...(target_scope === "workspace" ? { workspace_id: install_target } : {}) });
        if (!result.operation_success) throw new Error(result.error || "安装 Skill 失败");
        set_snapshot(result);
        ui.invalidate();
        ui.toast({ type: "success", message: "Skill 已安装" });
      } catch (reason) {
        const message = to_error_message(reason);
        set_error(message);
        ui.toast({ type: "error", message });
      } finally {
        set_busy_spec("");
      }
    };

    if (loading && !snapshot) return <LoadingState label="正在读取 Skills…" />;
    if (!snapshot) return <Page>{error
      ? <Callout tone="danger">{error}</Callout>
      : <EmptyState title="无法读取 Skills" description="请刷新后重试。" />}</Page>;
    if (scope === "discover") return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar title="发现 Skills" description="通过 skills CLI 搜索公开目录，并安装到个人目录或指定 Workspace。" actions={<Select value={install_target} options={[{ value: "home", label: "Personal Skills" }, ...(snapshot?.workspaces.map((item) => ({ value: item.workspace_id, label: item.name })) ?? [])]} on_value_change={set_install_target} />} />
      <Inline fill><Input value={query} placeholder="搜索 skills.sh" on_value_change={set_query} /><Button disabled={searching || !query.trim()} on_click={() => void search()}>{searching ? "搜索中…" : "搜索"}</Button></Inline>
      {!hits.length ? <EmptyState title="搜索并发现新的 Skill" description="输入能力关键词，例如 browser、slides 或 research。" size="compact" /> : <Group>{hits.map((hit) => <Row key={hit.spec} label={hit.skill || hit.spec} description={hit.spec} trailing={<Button variant="primary" disabled={Boolean(busy_spec)} on_click={() => void install(hit)}>{busy_spec === hit.spec ? "安装中…" : "安装"}</Button>} />)}</Group>}
    </Page>;
    if (scope === "workspace" && !snapshot?.workspaces.length) return <Page><EmptyState title="还没有 Workspace" description="先在 Downcity 中添加一个 Workspace。" /></Page>;
    if (selected_skill) return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar title={selected_skill.name} description={`${selected_skill.scope === "workspace" ? workspace?.name ?? "Workspace" : "Personal"} · ${selected_skill.id}`} actions={skill_menu(selected_skill)} />
      <Group>
        <Row label="Scope" trailing={<Status>{selected_skill.scope === "workspace" ? workspace?.name ?? "Workspace" : "Personal"}</Status>} />
        <Row label="Skill ID" trailing={<Status>{selected_skill.id}</Status>} />
        <Row label="Allowed tools" trailing={<Status>{selected_skill.allowed_tools.length ? selected_skill.allowed_tools.join(", ") : "未限制"}</Status>} />
      </Group>
      <Section title="SKILL.md">{reading ? <LoadingState label="正在读取 Skill…" /> : content ? <Markdown text={content} /> : <EmptyState title="Skill 内容为空" size="compact" />}</Section>
    </Page>;
    return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Toolbar title={scope === "workspace" ? workspace?.name || "Workspace Skills" : "Personal Skills"} description={scope === "workspace" ? `.agents/skills · ${skills.length} Skills` : `~/.agents/skills · ${skills.length} Skills`} actions={<Button disabled={loading} on_click={ui.invalidate}>{loading ? "刷新中…" : "刷新"}</Button>} />
      <Input value={filter} placeholder="搜索已安装 Skills" on_value_change={set_filter} />
      {!visible_skills.length ? <EmptyState title={filter.trim() ? "没有匹配的 Skill" : "还没有 Skill"} size="compact" /> : <Group>{visible_skills.map((skill) => <Row key={skill_key(skill)} label={skill.name} description={skill.description || skill.id} trailing={skill_menu(skill, true)} on_click={() => select_skill(skill)} />)}</Group>}
    </Page>;
  },
});

/** 创建 Workspace 范围的稳定 Power route。 */
function workspace_route(workspace_id: string, skill_id?: string) { return { scope: "workspace", workspace_id, ...(skill_id ? { skill_id } : {}) }; }

/** 创建 Skill read/remove action 的稳定输入。 */
function skill_input(skill: SkillMainviewItem) { return { scope: skill.scope, skill_id: skill.id, ...(skill.workspace_id ? { workspace_id: skill.workspace_id } : {}) }; }

/** 判断当前 route 是否与一个 Skill 的范围一致。 */
function selected_scope_matches(skill: SkillMainviewItem, scope: SkillMainviewScope | "discover", workspace_id: string): boolean { return skill.scope === scope && (skill.scope === "home" || skill.workspace_id === workspace_id); }

/** 构造 Skill 在不同 Workspace 与个人范围间唯一的选中键。 */
function skill_key(skill: SkillMainviewItem): string { return `${skill.scope}:${skill.workspace_id ?? "home"}:${skill.id}`; }

/** 切换树节点的展开状态，并返回新的不可变集合。 */
function toggle_key(current: Set<string>, key: string): Set<string> { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }

/** 从宿主 JSON route 读取稳定 Skill 分区，未知值回退到 Workspace。 */
function read_scope(value: unknown): SkillMainviewScope | "discover" { return value === "home" || value === "discover" ? value : "workspace"; }

/** 从宿主 JSON route 中读取一个可选字符串。 */
function read_route(value: unknown): string { return typeof value === "string" ? value : ""; }

/** 把未知失败转换为用户可见消息。 */
function to_error_message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
