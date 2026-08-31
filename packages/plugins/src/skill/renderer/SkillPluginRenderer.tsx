/**
 * Skill Plugin 的功能主页。
 *
 * Sidebar 负责工作区、个人与发现导航；Mainview 只渲染当前路由对应的业务内容。
 * 文件和网络操作全部通过 Plugin action gateway 交给宿主 main。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { define_plugin_renderer } from "@downcity/plugin/react";
import type {
  SkillMainviewItem,
  SkillMainviewMutationResult,
  SkillMainviewReadResult,
  SkillMainviewScope,
  SkillMainviewSearchHit,
  SkillMainviewSearchResult,
  SkillMainviewSnapshot,
} from "@/skill/types/SkillMainview.js";

/** Skill Plugin Renderer 定义。 */
export const SKILL_PLUGIN_RENDERER = define_plugin_renderer({
  sidebar: function SkillPluginSidebar({ plugin, navigation, ui }) {
    const { Callout, Sidebar, SidebarItem, SidebarSection } = ui.components;
    const [snapshot, set_snapshot] = useState<SkillMainviewSnapshot>();
    const [error, set_error] = useState("");
    useEffect(() => {
      let disposed = false;
      set_error("");
      void plugin.invoke<SkillMainviewSnapshot>("skills.list")
        .then((next) => { if (!disposed) set_snapshot(next); })
        .catch((reason) => { if (!disposed) set_error(to_error_message(reason)); });
      return () => { disposed = true; };
    }, [plugin]);
    const scope = read_scope(navigation.route.scope);
    return <Sidebar><SidebarSection label="Skills">
      <SidebarItem label="工作区" trailing={snapshot?.workspaces.reduce((count, item) => count + item.skills.length, 0) ?? 0} active={scope === "workspace"} on_select={() => navigation.navigate({ scope: "workspace" })} />
      <SidebarItem label="个人" trailing={snapshot?.home_skills.length ?? 0} active={scope === "home"} on_select={() => navigation.navigate({ scope: "home" })} />
      <SidebarItem label="发现" active={scope === "discover"} on_select={() => navigation.navigate({ scope: "discover" })} />
    </SidebarSection>{error ? <Callout tone="danger">{error}</Callout> : null}</Sidebar>;
  },
  mainview: function SkillPluginMainview({ plugin, navigation, ui }) {
    const { Button, Callout, CodeBlock, EmptyState, Group, Inline, Input, LoadingState, Page, Row, Section, Select, Toolbar } = ui.components;
    const tab = read_scope(navigation.route.scope);
    const [snapshot, set_snapshot] = useState<SkillMainviewSnapshot>();
    const [workspace_id, set_workspace_id] = useState("");
    const [filter, set_filter] = useState("");
    const [query, set_query] = useState("");
    const [hits, set_hits] = useState<SkillMainviewSearchHit[]>([]);
    const [install_target, set_install_target] = useState("home");
    const [selected_key, set_selected_key] = useState("");
    const [content, set_content] = useState("");
    const [loading, set_loading] = useState(true);
    const [reading, set_reading] = useState(false);
    const [searching, set_searching] = useState(false);
    const [busy_spec, set_busy_spec] = useState("");
    const [error, set_error] = useState("");

    const refresh = useCallback(async () => {
      set_loading(true);
      set_error("");
      try {
        const next = await plugin.invoke<SkillMainviewSnapshot>("skills.list");
        set_snapshot(next);
        set_workspace_id((current) => next.workspaces.some((item) => item.workspace_id === current)
          ? current
          : next.workspaces[0]?.workspace_id ?? "");
        set_install_target((current) => current === "home" || next.workspaces.some((item) => item.workspace_id === current)
          ? current
          : next.workspaces[0]?.workspace_id ?? "home");
      } catch (reason) {
        set_error(to_error_message(reason));
      } finally {
        set_loading(false);
      }
    }, [plugin]);

    useEffect(() => { void refresh(); }, [refresh]);

    const workspace = snapshot?.workspaces.find((item) => item.workspace_id === workspace_id);
    const visible_skills = useMemo(() => {
      const skills = tab === "workspace" ? workspace?.skills ?? [] : snapshot?.home_skills ?? [];
      const normalized_filter = filter.trim().toLowerCase();
      return normalized_filter
        ? skills.filter((skill) => `${skill.name} ${skill.id} ${skill.description}`.toLowerCase().includes(normalized_filter))
        : skills;
    }, [filter, snapshot, tab, workspace]);

    const read_skill = async (skill: SkillMainviewItem) => {
      const key = `${skill.scope}:${skill.workspace_id ?? "home"}:${skill.id}`;
      if (selected_key === key) {
        set_selected_key("");
        set_content("");
        return;
      }
      set_selected_key(key);
      set_content("");
      set_reading(true);
      try {
        const result = await plugin.invoke<SkillMainviewReadResult>("skills.read", {
          scope: skill.scope,
          skill_id: skill.id,
          ...(skill.workspace_id ? { workspace_id: skill.workspace_id } : {}),
        });
        set_content(result.success ? result.content ?? "" : result.error ?? "读取 Skill 失败");
      } catch (reason) {
        set_content(to_error_message(reason));
      } finally {
        set_reading(false);
      }
    };

    const remove_skill = async (skill: SkillMainviewItem) => {
      const confirmed = await ui.confirm({
        title: `删除 ${skill.name}？`,
        description: "对应 Skill 目录会从当前配置范围永久删除。",
        action: "删除",
        destructive: true,
      });
      if (!confirmed) return;
      set_loading(true);
      set_error("");
      try {
        const result = await plugin.invoke<SkillMainviewMutationResult>("skills.remove", {
          scope: skill.scope,
          skill_id: skill.id,
          ...(skill.workspace_id ? { workspace_id: skill.workspace_id } : {}),
        });
        if (!result.operation_success) throw new Error(result.error || "删除 Skill 失败");
        set_snapshot(result);
        set_selected_key("");
        set_content("");
        ui.toast({ type: "success", message: "Skill 已删除" });
      } catch (reason) {
        const message = to_error_message(reason);
        set_error(message);
        ui.toast({ type: "error", message });
      } finally {
        set_loading(false);
      }
    };

    const search = async () => {
      const normalized_query = query.trim();
      if (!normalized_query) return;
      set_searching(true);
      set_error("");
      try {
        const result = await plugin.invoke<SkillMainviewSearchResult>("skills.find", { query: normalized_query });
        if (!result.success) throw new Error(result.error || "搜索 Skill 失败");
        set_hits(result.hits);
      } catch (reason) {
        set_error(to_error_message(reason));
      } finally {
        set_searching(false);
      }
    };

    const install = async (hit: SkillMainviewSearchHit) => {
      const scope: SkillMainviewScope = install_target === "home" ? "home" : "workspace";
      set_busy_spec(hit.spec);
      set_error("");
      try {
        const result = await plugin.invoke<SkillMainviewMutationResult>("skills.install", {
          scope,
          spec: hit.spec,
          ...(scope === "workspace" ? { workspace_id: install_target } : {}),
        });
        if (!result.operation_success) throw new Error(result.error || "安装 Skill 失败");
        set_snapshot(result);
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

    return <Page>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {tab === "discover" ? <>
        <Toolbar
          title="发现 Skills"
          description="通过 skills CLI 搜索公开目录，并安装到个人目录或指定工作区。"
          actions={<Select
            value={install_target}
            options={[
              { value: "home", label: "个人 Skills" },
              ...(snapshot?.workspaces.map((item) => ({ value: item.workspace_id, label: item.name })) ?? []),
            ]}
            on_value_change={set_install_target}
          />}
        />
        <Inline fill>
          <Input value={query} placeholder="搜索 skills.sh" on_value_change={set_query} />
          <Button disabled={searching || !query.trim()} on_click={() => void search()}>{searching ? "搜索中…" : "搜索"}</Button>
        </Inline>
        {!hits.length ? <EmptyState title="搜索并发现新的 Skill" description="输入能力关键词，例如 browser、slides 或 research。" size="compact" />
          : <Group>{hits.map((hit) => <Row
            key={hit.spec}
            label={hit.skill || hit.spec}
            description={hit.spec}
            trailing={<Button variant="primary" disabled={Boolean(busy_spec)} on_click={() => void install(hit)}>{busy_spec === hit.spec ? "安装中…" : "安装"}</Button>}
          />)}</Group>}
      </> : <>
        <Toolbar
          title={tab === "workspace" ? workspace?.name || "工作区 Skills" : "个人 Skills"}
          description={tab === "workspace" ? "当前工作区 .agents/skills 中可供 Agent 使用的能力。" : "用户目录 ~/.agents/skills 中可复用的能力。"}
          actions={<Inline>
            {tab === "workspace" && snapshot?.workspaces.length ? <Select
              value={workspace_id}
              options={snapshot.workspaces.map((item) => ({ value: item.workspace_id, label: item.name }))}
              on_value_change={(value) => { set_workspace_id(value); set_selected_key(""); set_content(""); }}
            /> : null}
            <Button disabled={loading} on_click={() => void refresh()}>{loading ? "刷新中…" : "刷新"}</Button>
          </Inline>}
        />
        <Input value={filter} placeholder="搜索已安装 Skills" on_value_change={set_filter} />
        {tab === "workspace" && !snapshot?.workspaces.length ? <EmptyState title="还没有 Workspace" description="先在 Downcity 中添加一个 Workspace。" size="compact" />
          : !visible_skills.length ? <EmptyState title="没有找到 Skill" size="compact" />
            : <Group>{visible_skills.map((skill) => {
              const key = `${skill.scope}:${skill.workspace_id ?? "home"}:${skill.id}`;
              return <div key={key}>
                <Row
                  label={skill.name}
                  description={skill.description || skill.id}
                  trailing={<Inline>
                    <Button on_click={() => void read_skill(skill)}>{selected_key === key ? "收起" : "查看"}</Button>
                    <Button variant="destructive" on_click={() => void remove_skill(skill)}>删除</Button>
                  </Inline>}
                />
                {selected_key === key ? <Section surface={false}>
                  {reading ? <LoadingState label="正在读取 Skill…" /> : <CodeBlock>{content || "Skill 内容为空"}</CodeBlock>}
                </Section> : null}
              </div>;
            })}</Group>}
      </>}
    </Page>;
  },
});

/** 把未知失败转换为用户可见消息。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** 从宿主路由读取稳定 Skill 分区，未知值回退到工作区。 */
function read_scope(value: unknown): SkillMainviewScope | "discover" {
  return value === "home" || value === "discover" ? value : "workspace";
}
