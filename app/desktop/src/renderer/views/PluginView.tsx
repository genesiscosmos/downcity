/** Plugin Profile 外壳与唯一 Mainview 页面。 */

import { useCallback, useEffect, useState } from "react";
import { TbComponents, TbPlus, TbTrash } from "react-icons/tb";
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
import { Select } from "@/components/ui/select";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";
import { PluginRendererFrame } from "@/lib/plugin/PluginRendererFrame";
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
    set_creating(true);
    set_error("");
    try {
      const next = await controller.remove_plugin_profile(plugin.plugin_id, profile_id);
      set_definition(next);
      set_profile_id(next.profile_ids[0] ?? "");
      set_delete_open(false);
    } catch (reason) {
      set_error(to_error(reason));
    } finally {
      set_creating(false);
    }
  };

  const profile_options = definition?.profile_ids.map((id) => ({
    value: id,
    label: id,
  })) ?? [];

  return <MainViewLayout>
    <MainViewHeader
      bordered
      title={<span className="flex min-w-0 items-center gap-2"><TbComponents /><span className="truncate">{plugin.title}</span></span>}
      right_actions={<>
        {profile_options.length > 0 ? <Select value={profile_id} options={profile_options} on_value_change={set_profile_id} className="min-w-32" align="end" /> : null}
        <Button size="icon" title="新建 Profile" aria-label="新建 Profile" onClick={() => set_create_open(true)}><TbPlus /></Button>
        {profile_id ? <Button size="icon" title="删除 Profile" aria-label="删除 Profile" onClick={() => set_delete_open(true)}><TbTrash /></Button> : null}
      </>}
    />
    <MainViewBody>
      {loading && !definition ? <PluginState title="正在加载 Plugin…" />
        : !profile_id ? <PluginState title="还没有 Profile" description="创建一个 Profile 后，在同一页面完成配置并分配给 Agent。" action={<Button variant="primary" onClick={() => set_create_open(true)}><TbPlus />新建 Profile</Button>} />
          : definition?.renderer_html ? <PluginRendererFrame
            key={`${plugin.plugin_id}:${profile_id}`}
            plugin_id={plugin.plugin_id}
            profile_id={profile_id}
            renderer_html={definition.renderer_html}
            invoke={(action_id, input) => controller.invoke_plugin_action(plugin.plugin_id, {
              profile_id,
              action_id,
              ...(input !== undefined ? { input } : {}),
            })}
          />
            : <PluginState title="这个 Plugin 没有 Mainview" description="Profile 已由宿主创建；该 Plugin 需要通过自己的其他入口完成配置。" />}
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

/** Plugin 页面中的统一空状态。 */
function PluginState({ title, description, action }: {
  /** 状态标题。 */
  title: string;
  /** 可选说明。 */
  description?: string;
  /** 可选操作。 */
  action?: React.ReactNode;
}) {
  return <div className="flex min-h-0 flex-1 items-center justify-center p-8"><div className="max-w-sm text-center"><div className="text-sm font-medium">{title}</div>{description ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p> : null}{action ? <div className="mt-4 flex justify-center">{action}</div> : null}</div></div>;
}

/** 把未知失败转换为用户可见文本。 */
function to_error(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
