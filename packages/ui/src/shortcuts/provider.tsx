/** 快捷键全局监听 Provider。 */
import { useEffect, type ReactNode } from "react";
import { get_shortcut_context } from "./context";
import { list_registered_shortcuts } from "./registry";
import { matches_shortcut } from "./types";

export function ShortcutProvider({ children }: { children?: ReactNode }) {
  useEffect(() => {
    const handle_key_down = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const context = get_shortcut_context(event);
      for (const { definition } of list_registered_shortcuts()) {
        if (!definition.keys.some((key) => matches_shortcut(event, key, context.platform))) continue;
        if (definition.when && !definition.when(context, event)) continue;
        const result = definition.run(context, event);
        if (result === false) continue;
        if (definition.prevent_default !== false) event.preventDefault();
        if (definition.stop_propagation !== false) event.stopPropagation();
        return;
      }
    };
    window.addEventListener("keydown", handle_key_down, true);
    return () => window.removeEventListener("keydown", handle_key_down, true);
  }, []);
  return children ?? null;
}
