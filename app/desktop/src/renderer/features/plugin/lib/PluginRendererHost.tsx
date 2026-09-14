/** Plugin Sidebar、Mainview 与 Config 的统一插槽宿主。 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PluginJsonObject, PluginJsonValue } from "@downcity/city/plugin";
import type { PluginRendererConfirmInput, PluginRendererDefinition, PluginRendererUi } from "@downcity/city/plugin/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { create_plugin_renderer_ui_components } from "@/features/plugin/lib/PluginRendererComponents";
import { SidebarHeader } from "@/layouts/sidebar/SidebarHeader";
import type { LoadedPluginRenderer, PluginRendererCapabilities, PluginRendererConfirmationState, PluginRendererHostProps, PluginRendererToastState } from "@/types/plugin/PluginRendererHost";
import { use_translation } from "@/locales/i18n";

/** 加载 Plugin Renderer，并且只渲染宿主指定的一个独立插槽。 */
export function PluginRendererHost(props: PluginRendererHostProps) {
  const translate = use_translation("plugin");
  const [loaded_renderer, set_loaded_renderer] = useState<LoadedPluginRenderer>();
  const [load_error, set_load_error] = useState("");
  const [confirmation, set_confirmation] = useState<PluginRendererConfirmationState>();
  const [toast, set_toast] = useState<PluginRendererToastState>();
  const confirmation_resolve_ref = useRef<((confirmed: boolean) => void) | undefined>(undefined);
  const toast_sequence_ref = useRef(0);
  const toast_timer_ref = useRef<number | undefined>(undefined);
  const ui_components = useMemo(() => create_plugin_renderer_ui_components({ plugin_id: props.plugin_id, surface: props.slot, sidebar_title: props.sidebar_title }), [props.plugin_id, props.sidebar_title, props.slot]);

  useEffect(() => {
    let disposed = false;
    set_loaded_renderer(undefined);
    set_load_error("");
    if (!props.renderer_url) return () => { disposed = true; };
    void import(/* @vite-ignore */ props.renderer_url)
      .then((module: { default?: unknown }) => {
        assert_renderer_definition(module.default, props.capabilities, props.plugin_id);
        if (!disposed) set_loaded_renderer({ renderer_url: props.renderer_url!, definition: module.default });
      })
      .catch((reason) => { if (!disposed) set_load_error(to_error_message(reason)); });
    return () => { disposed = true; };
  }, [props.capabilities, props.plugin_id, props.renderer_url]);

  useEffect(() => () => {
    if (toast_timer_ref.current !== undefined) window.clearTimeout(toast_timer_ref.current);
    confirmation_resolve_ref.current?.(false);
  }, []);

  const show_toast = useCallback<PluginRendererUi["toast"]>((input) => {
    if (toast_timer_ref.current !== undefined) window.clearTimeout(toast_timer_ref.current);
    const toast_id = ++toast_sequence_ref.current;
    set_toast({ ...input, toast_id });
    toast_timer_ref.current = window.setTimeout(() => {
      set_toast((current) => current?.toast_id === toast_id ? undefined : current);
    }, 3000);
  }, []);

  const confirm = useCallback((input: PluginRendererConfirmInput): Promise<boolean> => new Promise((resolve) => {
    confirmation_resolve_ref.current?.(false);
    confirmation_resolve_ref.current = resolve;
    set_confirmation({ input });
  }), []);

  const plugin = useMemo(() => ({
    invoke: async <Result = PluginJsonValue>(action_id: string, input?: PluginJsonValue): Promise<Result> =>
      await props.invoke_mainview(action_id, input) as Result,
  }), [props.invoke_mainview]);
  const config = useMemo(() => ({
    invoke: async <Result = PluginJsonValue>(action_id: string, input?: PluginJsonValue): Promise<Result> => {
      if (!props.invoke_config) throw new Error("Plugin Config gateway is unavailable");
      return await props.invoke_config(action_id, input) as Result;
    },
  }), [props.invoke_config]);
  const navigate = useCallback((route: PluginJsonObject) => props.navigate?.(route), [props.navigate]);
  const navigation = useMemo(() => ({
    route: props.route ?? {},
    navigate,
  }), [navigate, props.route]);
  const invalidate = useCallback(() => props.invalidate?.(), [props.invalidate]);
  const ui = useMemo<PluginRendererUi>(() => ({ revision: props.revision ?? 0, invalidate, components: ui_components, toast: show_toast, confirm }), [confirm, invalidate, props.revision, show_toast, ui_components]);
  const definition = props.builtin_renderer ?? (loaded_renderer?.renderer_url === props.renderer_url ? loaded_renderer?.definition : undefined);
  const definition_error = definition ? get_renderer_definition_error(definition, props.capabilities) : undefined;
  const Config = definition?.config;
  const Workspace = props.slot === "sidebar" ? definition?.sidebar : definition?.mainview;
  const workspace_props = { plugin, navigation, notifications: props.notifications ?? [], ui };
  const sidebar_fallback_header = props.slot === "sidebar" && (load_error || definition_error || !Workspace);

  const close_confirmation = (confirmed: boolean) => {
    const resolve = confirmation_resolve_ref.current;
    confirmation_resolve_ref.current = undefined;
    set_confirmation(undefined);
    resolve?.(confirmed);
  };

  return <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
    {sidebar_fallback_header ? <SidebarHeader title={props.sidebar_title ?? props.plugin_id} /> : null}
    {load_error || definition_error ? <ui_components.Callout tone="danger">{load_error || `Plugin renderer definition is invalid: ${props.plugin_id} (${definition_error})`}</ui_components.Callout>
      : !definition ? <ui_components.LoadingState label={translate("loading")} />
        : props.slot === "config"
          ? Config ? <Config config={config} ui={ui} /> : <ui_components.EmptyState title={translate("missing_config")} size="compact" />
          : Workspace ? <Workspace {...workspace_props} /> : <ui_components.EmptyState title={translate("missing_slot", { slot: props.slot })} size="compact" />}
    {toast ? <div className="fixed bottom-5 left-1/2 z-40 max-w-xl -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">{toast.message}</div> : null}
    <Dialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open) close_confirmation(false); }}>
      <DialogContent size="sm"><DialogHeader><div><DialogTitle>{confirmation?.input.title}</DialogTitle>{confirmation?.input.description ? <DialogDescription>{confirmation.input.description}</DialogDescription> : null}</div></DialogHeader><DialogFooter><Button onClick={() => close_confirmation(false)}>{translate("cancel")}</Button><Button variant={confirmation?.input.destructive ? "destructive" : "primary"} onClick={() => close_confirmation(true)}>{confirmation?.input.action || translate("confirm")}</Button></DialogFooter></DialogContent>
    </Dialog>
  </div>;
}

/** 校验 Renderer ESM 与静态清单声明完全一致。 */
function assert_renderer_definition(
  value: unknown,
  capabilities: PluginRendererCapabilities,
  plugin_id: string,
): asserts value is PluginRendererDefinition {
  const error = get_renderer_definition_error(value, capabilities);
  if (error) throw new Error(`Plugin renderer definition is invalid: ${plugin_id} (${error})`);
}

/** 返回 Renderer 定义的结构或能力差异。 */
function get_renderer_definition_error(
  value: unknown,
  capabilities: PluginRendererCapabilities,
): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "default export must be an object";
  const definition = value as PluginRendererDefinition;
  const sidebar = typeof definition.sidebar === "function";
  const mainview = typeof definition.mainview === "function";
  const config = typeof definition.config === "function";
  if (sidebar !== mainview) return "sidebar and mainview must be provided together";
  if (!sidebar && !config) return "at least one UI capability is required";
  if (sidebar !== capabilities.has_sidebar) return "sidebar does not match plugin.json";
  if (mainview !== capabilities.has_mainview) return "mainview does not match plugin.json";
  if (config !== capabilities.has_config) return "config does not match plugin.json";
  return undefined;
}

/** 把未知失败转换为用户可见消息。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
