/** Plugin Catalog 中的描述与配置详情页。 */

import { useCallback, useEffect, useState } from "react";
import { TbChevronDown } from "react-icons/tb";
import { MainViewBody, MainViewHeader, MainViewLayout } from "@/layouts/MainViewLayout";
import { Markdown } from "@/components/markdown/Markdown";
import { PluginIcon } from "@/features/plugin/lib/PluginIcon";
import { cn } from "@/lib/utils";
import { PluginConfigPanel } from "@/views/PluginSettings";
import type { DesktopActions } from "@/types/DesktopView";
import type { DesktopPluginDefinition, DesktopPluginSummary } from "@common/types/DesktopApi";
import { use_translation } from "@/locales/i18n";

/** 所有 Plugin 都展示说明；只有声明 Config 时才展示 Profile 配置。 */
export function PluginView({ plugin, controller }: {
  /** 当前 Plugin。 */ readonly plugin: DesktopPluginSummary;
  /** Renderer 稳定操作集合。 */ readonly controller: DesktopActions;
}) {
  const translate = use_translation("plugin");
  const [definition, set_definition] = useState<DesktopPluginDefinition>();
  const [error, set_error] = useState("");
  const get_plugin = controller.get_plugin;
  const load = useCallback(async () => {
    set_definition(undefined);
    set_error("");
    try { set_definition(await get_plugin(plugin.plugin_id)); }
    catch (reason) { set_error(reason instanceof Error ? reason.message : String(reason)); }
  }, [get_plugin, plugin.plugin_id]);
  useEffect(() => { void load(); }, [load]);
  return <MainViewLayout>
    <MainViewHeader />
    <MainViewBody><main className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-full w-full max-w-[90rem] flex-col gap-5 px-4 pb-8 pt-3 md:px-6 md:pb-10 md:pt-4">
        <PluginOverview plugin={definition ?? plugin} />
        {error ? <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
        {plugin.has_config ? <PluginConfigPanel controller={controller} plugin={plugin} definition={definition} set_definition={set_definition} /> : <section className="rounded-xl bg-surface-subtle px-5 py-10 text-center"><div className="text-sm text-foreground">{translate("config.not_required")}</div><div className="mt-1 text-xs text-muted-foreground">{translate("config.not_required_description")}</div></section>}
      </div>
    </main></MainViewBody>
  </MainViewLayout>;
}

/** 展示可折叠的 Plugin 身份与用户说明。 */
function PluginOverview({ plugin }: {
  /** 当前 Plugin 摘要与可选 README。 */ readonly plugin: DesktopPluginSummary & Partial<Pick<DesktopPluginDefinition, "readme">>;
}) {
  const [expanded, set_expanded] = useState(false);
  return <section className="min-w-0 overflow-hidden rounded-xl bg-surface-subtle">
    <div className="flex min-h-16 items-center gap-3 px-4 py-3.5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/[0.08] text-primary"><PluginIcon plugin_id={plugin.plugin_id} icon_url={plugin.icon_url} class_name="size-5" /></div>
      <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-foreground">{plugin.title}</div><div className="mt-1 text-[10px] text-muted-foreground">{plugin.description}</div></div>
      {plugin.readme ? <button type="button" aria-expanded={expanded} onClick={() => set_expanded((current) => !current)} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-interaction-hover"><TbChevronDown className={cn("size-4 transition-transform", !expanded && "-rotate-90")} /></button> : null}
    </div>
    {expanded && plugin.readme ? <div className="border-t border-divider px-4 py-4"><Markdown text={plugin.readme} mode="static" class_name="plugin-readme !h-auto" /></div> : null}
  </section>;
}
