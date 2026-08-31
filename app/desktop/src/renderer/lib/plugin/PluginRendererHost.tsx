/**
 * Plugin 唯一 React Mainview 的宿主容器。
 *
 * 容器负责加载第三方 ESM、注入绑定当前 Plugin/Profile 的 action gateway、统一 UI
 * Components、Toast 与确认对话框。Plugin 组件不会获得 Desktop controller 或 Profile ID。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PluginJsonValue } from "@downcity/plugin";
import type {
  PluginRendererComponent,
  PluginRendererConfirmInput,
  PluginRendererUi,
} from "@downcity/plugin/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { create_plugin_renderer_ui_components } from "./PluginRendererComponents";
import type {
  LoadedPluginRenderer,
  PluginRendererConfirmationState,
  PluginRendererHostProps,
  PluginRendererToastState,
} from "@/types/plugin/PluginRendererHost";

/** 渲染内置或第三方 Plugin 的唯一 Mainview。 */
export function PluginRendererHost(props: PluginRendererHostProps) {
  const [loaded_renderer, set_loaded_renderer] = useState<LoadedPluginRenderer>();
  const [load_error, set_load_error] = useState("");
  const [confirmation, set_confirmation] = useState<PluginRendererConfirmationState>();
  const [toast, set_toast] = useState<PluginRendererToastState>();
  const confirmation_resolve_ref = useRef<((confirmed: boolean) => void) | undefined>(undefined);
  const toast_sequence_ref = useRef(0);
  const toast_timer_ref = useRef<number | undefined>(undefined);
  const ui_components = useMemo(() => create_plugin_renderer_ui_components(), []);

  useEffect(() => {
    let disposed = false;
    set_loaded_renderer(undefined);
    set_load_error("");
    if (!props.renderer_url) return () => { disposed = true; };
    const load_renderer = async () => {
      try {
        const module = await import(/* @vite-ignore */ props.renderer_url!) as { default?: unknown };
        if (typeof module.default !== "function") {
          throw new Error(`Plugin renderer must default export a Mainview component: ${props.plugin_id}`);
        }
        if (!disposed) set_loaded_renderer({
          renderer_url: props.renderer_url!,
          Component: module.default as PluginRendererComponent,
        });
      } catch (reason) {
        if (!disposed) set_load_error(to_error_message(reason));
      }
    };
    void load_renderer();
    return () => { disposed = true; };
  }, [props.plugin_id, props.renderer_url]);

  useEffect(() => () => {
    if (toast_timer_ref.current !== undefined) window.clearTimeout(toast_timer_ref.current);
    confirmation_resolve_ref.current?.(false);
    confirmation_resolve_ref.current = undefined;
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
    invoke: async <Result extends PluginJsonValue = PluginJsonValue>(
      action_id: string,
      input?: PluginJsonValue,
    ): Promise<Result> => await props.invoke(action_id, input) as Result,
  }), [props.invoke]);

  const ui = useMemo<PluginRendererUi>(() => ({
    components: ui_components,
    toast: show_toast,
    confirm,
  }), [confirm, show_toast, ui_components]);

  const Component = props.builtin_renderer
    ?? (loaded_renderer && loaded_renderer.renderer_url === props.renderer_url
      ? loaded_renderer.Component
      : undefined);

  const close_confirmation = (confirmed: boolean) => {
    const resolve = confirmation_resolve_ref.current;
    if (!resolve) return;
    confirmation_resolve_ref.current = undefined;
    resolve(confirmed);
    set_confirmation(undefined);
  };

  return <div className="relative min-h-0 min-w-0 flex-1">
    <div className="min-h-full">
      {load_error ? <ui_components.Callout tone="danger">{load_error}</ui_components.Callout>
        : !Component ? <ui_components.LoadingState label="正在加载 Plugin Mainview…" />
          : <Component plugin={plugin} ui={ui} />}
    </div>
    {toast ? <div className={`fixed bottom-5 left-1/2 z-40 max-w-xl -translate-x-1/2 rounded-lg border px-3 py-2 text-xs shadow-xl ${toast.type === "error" ? "border-destructive/25 bg-background text-destructive" : "border-border bg-popover text-popover-foreground"}`}><div>{toast.message}</div>{toast.description ? <div className="mt-0.5 text-[11px] text-muted-foreground">{toast.description}</div> : null}</div> : null}
    <Dialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open) close_confirmation(false); }}>
      <DialogContent size="sm">
        <DialogHeader><div><DialogTitle>{confirmation?.input.title}</DialogTitle>{confirmation?.input.description ? <DialogDescription>{confirmation.input.description}</DialogDescription> : null}</div></DialogHeader>
        <DialogFooter><Button onClick={() => close_confirmation(false)}>取消</Button><Button variant={confirmation?.input.destructive ? "destructive" : "primary"} onClick={() => close_confirmation(true)}>{confirmation?.input.action || "确认"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

/** 把未知失败转换为用户可见消息。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
