/** Plugin Profile 外壳与唯一 Mainview 页面。 */

import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { TbChevronDown, TbPlus, TbTrash } from "react-icons/tb";
import type { PluginJsonValue } from "@downcity/plugin";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";
import { PluginIcon } from "@/lib/plugin/PluginIcon";
import { PluginRendererHost } from "@/lib/plugin/PluginRendererHost";
import { Markdown } from "@/lib/markdown/Markdown";
import { cn } from "@/lib/utils";
import { BUILTIN_PLUGIN_RENDERERS } from "@downcity/plugins/renderers";
import type { DesktopViewController } from "@/types/DesktopView";
import type {
  DesktopPluginDefinition,
  DesktopPluginSummary,
} from "@common/types/DesktopApi";

/** Plugin 详情属性。 */
interface PluginViewProps {
  /** 当前 Plugin。 */
  plugin: DesktopPluginSummary;

  /** Renderer 根控制器。 */
  controller: DesktopViewController;
}

/** 展示 Profile 统一外壳，并把具体配置交给 Plugin Mainview。 */
export function PluginView({ plugin, controller }: PluginViewProps) {
  const [definition, set_definition] = useState<DesktopPluginDefinition>();
  const [profile_id, set_profile_id] = useState("");
  const [loading, set_loading] = useState(false);
  const [creating, set_creating] = useState(false);
  const [create_open, set_create_open] = useState(false);
  const [delete_open, set_delete_open] = useState(false);
  const [new_profile_id, set_new_profile_id] = useState("");
  const [error, set_error] = useState("");

  const load = useCallback(async () => {
    set_loading(true);
    set_error("");
    try {
      const next = await controller.get_plugin(plugin.plugin_id);
      set_definition(next);
      set_profile_id((current) => next.profile_ids.includes(current)
        ? current
        : next.profile_ids[0] ?? "");
    } catch (reason) {
      set_error(to_error(reason));
    } finally {
      set_loading(false);
    }
  }, [controller, plugin.plugin_id]);

  useEffect(() => {
    set_definition(undefined);
    set_profile_id("");
    set_error("");
    void load();
  }, [load]);

  const create_profile = async () => {
    const next_id = new_profile_id.trim();
    if (!next_id) return;
    set_creating(true);
    set_error("");
    try {
      const next = await controller.create_plugin_profile(plugin.plugin_id, {
        profile_id: next_id,
      });
      set_definition(next);
      set_profile_id(next_id.toLowerCase());
      set_new_profile_id("");
      set_create_open(false);
    } catch (reason) {
      set_error(to_error(reason));
    } finally {
      set_creating(false);
    }
  };

  const remove_profile = async () => {
    if (!profile_id) return;
    const current_index = definition?.profile_ids.indexOf(profile_id) ?? -1;
    set_creating(true);
    set_error("");
    try {
      const next = await controller.remove_plugin_profile(plugin.plugin_id, profile_id);
      set_definition(next);
      set_profile_id(next.profile_ids[Math.min(Math.max(current_index, 0), next.profile_ids.length - 1)] ?? "");
      set_delete_open(false);
    } catch (reason) {
      set_error(to_error(reason));
    } finally {
      set_creating(false);
    }
  };

  const profile_ids = definition?.profile_ids ?? [];
  const builtin_renderer = plugin.source === "builtin"
    ? BUILTIN_PLUGIN_RENDERERS[plugin.plugin_id]
    : undefined;
  const invoke = useCallback((action_id: string, input?: PluginJsonValue) => controller.invoke_plugin_action(plugin.plugin_id, {
    profile_id,
    action_id,
    ...(input !== undefined ? { input } : {}),
  }), [controller, plugin.plugin_id, profile_id]);

  return <MainViewLayout>
    <MainViewHeader />
    <MainViewBody>
      <main className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto bg-background">
        <div className="mx-auto flex min-h-full w-full max-w-[90rem] flex-col px-4 pb-8 pt-3 md:px-6 md:pb-10 md:pt-4">
          <PluginOverview plugin={definition ?? plugin} />
          <ProfileTabs
            profile_ids={profile_ids}
            profile_id={profile_id}
            select_profile={set_profile_id}
            create_profile={() => set_create_open(true)}
            remove_profile={() => set_delete_open(true)}
          />
          <section
            id="plugin-profile-panel"
            role="tabpanel"
            aria-labelledby={profile_id ? `plugin-profile-tab-${profile_id}` : undefined}
            className="min-h-0 min-w-0 flex-1 pt-5"
          >
            {loading && !definition ? <PluginState title="正在加载 Plugin…" />
              : !profile_id ? <PluginState title="还没有 Profile" description="创建一个 Profile 后，在同一页面完成配置并分配给 Agent。" action={<Button variant="primary" onClick={() => set_create_open(true)}><TbPlus />新建 Profile</Button>} />
                : builtin_renderer || definition?.renderer_url ? <PluginRendererHost
                  key={`${plugin.plugin_id}:${profile_id}`}
                  plugin_id={plugin.plugin_id}
                  builtin_renderer={builtin_renderer}
                  renderer_url={definition?.renderer_url}
                  invoke={invoke}
                />
                  : <PluginState title="这个 Plugin 没有 Mainview" description="Profile 已由宿主创建；该 Plugin 需要通过自己的其他入口完成配置。" />}
          </section>
        </div>
      </main>
    </MainViewBody>
    {error ? <div className="absolute bottom-4 left-1/2 z-20 max-w-xl -translate-x-1/2 rounded-lg border border-destructive/25 bg-background px-3 py-2 text-xs text-destructive shadow-lg">{error}</div> : null}

    <Dialog open={create_open} onOpenChange={set_create_open}>
      <DialogContent size="sm">
        <DialogHeader><div><DialogTitle>新建 Profile</DialogTitle><DialogDescription>Profile 隔离 {plugin.title} 的一套完整配置，并可供多个 Agent 复用。</DialogDescription></div></DialogHeader>
        <DialogBody><label className="space-y-1.5"><span className="text-xs font-medium">Profile ID</span><input autoFocus className="h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-xs outline-none focus:border-ring" value={new_profile_id} placeholder="work" onChange={(event) => set_new_profile_id(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create_profile(); }} /></label></DialogBody>
        <DialogFooter><Button onClick={() => set_create_open(false)}>取消</Button><Button variant="primary" disabled={!new_profile_id.trim() || creating} onClick={() => void create_profile()}>{creating ? "创建中…" : "创建"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={delete_open} onOpenChange={set_delete_open}>
      <DialogContent size="sm">
        <DialogHeader><div><DialogTitle>删除 Profile？</DialogTitle><DialogDescription>{plugin.plugin_id}/{profile_id} 的配置会被永久删除；被 Agent 使用时宿主会拒绝操作。</DialogDescription></div></DialogHeader>
        <DialogFooter><Button onClick={() => set_delete_open(false)}>取消</Button><Button variant="destructive" disabled={creating} onClick={() => void remove_profile()}>{creating ? "删除中…" : "删除"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </MainViewLayout>;
}

/** 展示 Plugin 稳定身份、版本、描述与 Agent 使用状态。 */
function PluginOverview({ plugin }: {
  /** 当前 Plugin 摘要与加载后的可选 README。 */
  plugin: DesktopPluginSummary & Partial<Pick<DesktopPluginDefinition, "readme">>;
}) {
  const [expanded, set_expanded] = useState(plugin.profile_count === 0);
  useEffect(() => set_expanded(plugin.profile_count === 0), [plugin.plugin_id]);
  const has_readme = Boolean(plugin.readme?.trim());

  return <section className="min-w-0 overflow-hidden rounded-xl bg-surface-subtle">
    <div className="flex min-h-16 items-center gap-3 px-4 py-3.5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/[0.08] text-primary">
        <PluginIcon plugin_id={plugin.plugin_id} icon_url={plugin.icon_url} class_name="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{plugin.title}</div>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-full bg-muted-foreground/10 px-2 py-0.5 text-[0.625rem] tabular-nums text-muted-foreground">
            {plugin.source === "builtin" ? "Official" : "Installed"}
          </span>
          {plugin.version ? <span className="shrink-0 text-[0.625rem] tabular-nums text-muted-foreground/70">v{plugin.version}</span> : null}
          <span className="truncate font-mono text-[0.625rem] text-muted-foreground/55">{plugin.plugin_id}</span>
        </div>
      </div>
      <PluginAgentStatus plugin={plugin} />
    </div>
    {has_readme ? <button
      type="button"
      aria-expanded={expanded}
      aria-controls={`plugin-readme-${plugin.plugin_id}`}
      onClick={() => set_expanded((current) => !current)}
      className="flex w-full min-w-0 items-center gap-3 border-t border-divider px-4 py-3 text-left text-xs leading-5 text-muted-foreground transition-colors hover:bg-foreground/[0.025] hover:text-foreground/80"
    >
      <span className="min-w-0 flex-1">{plugin.description}</span>
      <TbChevronDown className={cn("size-3.5 shrink-0 transition-transform duration-150", !expanded && "-rotate-90")} />
    </button> : <div className="border-t border-divider px-4 py-3 text-xs leading-5 text-muted-foreground">
      {plugin.description || "该 Plugin 未提供用户可见描述。"}
    </div>}
    {expanded && plugin.readme ? <div id={`plugin-readme-${plugin.plugin_id}`} className="border-t border-divider px-4 py-4">
      <Markdown text={plugin.readme} mode="static" class_name="plugin-readme !h-auto" />
    </div> : null}
  </section>;
}

/** 显示 Plugin 是否可供 Agent 使用以及当前分配数量。 */
function PluginAgentStatus({ plugin }: { /** 当前 Plugin 完整摘要。 */ plugin: DesktopPluginSummary }) {
  if (!plugin.has_agent) return <span className="shrink-0 text-[0.6875rem] text-muted-foreground/60">仅宿主能力</span>;
  const used = plugin.agent_ids.length > 0;
  return <span className="flex shrink-0 items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
    <span className={cn("size-1.5 rounded-full", used ? "bg-emerald-500" : "bg-muted-foreground/25")} />
    {used ? `${plugin.agent_ids.length} 个 Agent 使用` : "尚未分配 Agent"}
  </span>;
}

/** 使用标准 Tab 交互切换、新建和删除 Profile。 */
function ProfileTabs({ profile_ids, profile_id, select_profile, create_profile, remove_profile }: {
  /** 当前 Plugin 的全部 Profile ID。 */ profile_ids: string[];
  /** 当前选中的 Profile ID。 */ profile_id: string;
  /** 选中一个 Profile。 */ select_profile(profile_id: string): void;
  /** 打开新建 Profile 交互。 */ create_profile(): void;
  /** 打开删除当前 Profile 交互。 */ remove_profile(): void;
}) {
  return <div className="mt-5 flex min-w-0 items-end border-b border-divider">
    <div role="tablist" aria-label="Plugin Profiles" className="scrollbar-none flex min-w-0 flex-1 items-end overflow-x-auto">
      {profile_ids.length === 0 ? <span className="flex h-9 items-center px-3 text-xs text-muted-foreground/55">Profiles</span> : profile_ids.map((id) => {
        const active = id === profile_id;
        return <button
          id={`plugin-profile-tab-${id}`}
          key={id}
          type="button"
          role="tab"
          aria-selected={active}
          aria-controls="plugin-profile-panel"
          tabIndex={active ? 0 : -1}
          onClick={() => select_profile(id)}
          onKeyDown={(event) => handle_profile_tab_key_down(event, profile_ids, id, select_profile)}
          className={cn(
            "relative flex h-9 shrink-0 items-center px-3 text-xs outline-none transition-colors duration-150",
            "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors after:duration-150",
            active
              ? "text-foreground after:bg-primary"
              : "text-muted-foreground after:bg-transparent hover:text-foreground focus-visible:bg-foreground/[0.05]",
          )}
        >{id}</button>;
      })}
    </div>
    <div className="flex h-9 shrink-0 items-center gap-0.5 pl-1">
      <Button size="icon" title="新建 Profile" aria-label="新建 Profile" onClick={create_profile}><TbPlus /></Button>
      {profile_id ? <Button size="icon" title={`删除 Profile ${profile_id}`} aria-label={`删除 Profile ${profile_id}`} onClick={remove_profile}><TbTrash /></Button> : null}
    </div>
  </div>;
}

/** 使 Profile Tabs 支持方向键、Home 与 End 自动激活。 */
function handle_profile_tab_key_down(
  event: KeyboardEvent<HTMLButtonElement>,
  profile_ids: string[],
  profile_id: string,
  select_profile: (profile_id: string) => void,
): void {
  const current_index = profile_ids.indexOf(profile_id);
  let next_index = current_index;
  if (event.key === "ArrowRight") next_index = (current_index + 1) % profile_ids.length;
  else if (event.key === "ArrowLeft") next_index = (current_index - 1 + profile_ids.length) % profile_ids.length;
  else if (event.key === "Home") next_index = 0;
  else if (event.key === "End") next_index = profile_ids.length - 1;
  else return;
  event.preventDefault();
  const next_profile_id = profile_ids[next_index];
  if (!next_profile_id) return;
  select_profile(next_profile_id);
  const tablist = event.currentTarget.closest('[role="tablist"]');
  const tabs = tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  window.requestAnimationFrame(() => tabs?.[next_index]?.focus());
}

/** Plugin 页面中的统一空状态。 */
function PluginState({ title, description, action }: {
  /** 状态标题。 */
  title: string;
  /** 可选说明。 */
  description?: string;
  /** 可选操作。 */
  action?: ReactNode;
}) {
  return <div className="flex min-h-52 items-center justify-center px-8 py-12"><div className="max-w-sm text-center"><div className="text-sm font-medium">{title}</div>{description ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p> : null}{action ? <div className="mt-4 flex justify-center">{action}</div> : null}</div></div>;
}

/** 把未知失败转换为用户可见文本。 */
function to_error(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
