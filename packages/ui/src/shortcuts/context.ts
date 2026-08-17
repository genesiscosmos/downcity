/** 从 DOM 事件构造快捷键执行所需的最小上下文。 */
import { detect_shortcut_platform, type ShortcutContext, type ShortcutFocus } from "./types";

function is_editable_element(element: HTMLElement | null): boolean {
  if (!element) return false;
  if (element.isContentEditable) return true;
  return ["input", "textarea", "select"].includes(element.tagName.toLowerCase()) || !!element.closest("[contenteditable='true'], input, textarea, select");
}

function detect_focus(element: HTMLElement | null): ShortcutFocus {
  if (!element) return "none";
  if (element.closest("[data-chat-input='true']")) return "chat-input";
  if (element.closest(".ProseMirror")) return "editor";
  return is_editable_element(element) ? "input" : "none";
}

export function get_shortcut_context(event: KeyboardEvent): ShortcutContext {
  const active_element = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const target = event.target instanceof HTMLElement ? event.target : active_element;
  return { platform: detect_shortcut_platform(), focus: detect_focus(target), active_element, target, is_editable_target: is_editable_element(target), has_text_selection: !!window.getSelection()?.toString().trim() };
}
