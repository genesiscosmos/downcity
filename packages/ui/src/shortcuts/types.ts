/** 快捷键模块的类型、平台判断与按键匹配工具。 */

export type ShortcutPlatform = "mac" | "windows" | "linux";
export type ShortcutScope = "global" | "sidebar" | "chat" | "editor" | "modal";
export type ShortcutPriority = "critical" | "high" | "normal" | "low";
export type ShortcutFocus = "none" | "input" | "editor" | "chat-input";

export type ShortcutContext = {
  /** 当前操作系统平台。 */
  platform: ShortcutPlatform;
  /** 当前焦点所在的 UI 类型。 */
  focus: ShortcutFocus;
  /** 当前文档激活元素。 */
  active_element: HTMLElement | null;
  /** 触发键盘事件的元素。 */
  target: HTMLElement | null;
  /** 目标是否为可编辑元素。 */
  is_editable_target: boolean;
  /** 页面是否存在文本选区。 */
  has_text_selection: boolean;
};

export type ShortcutDefinition = {
  /** 稳定且唯一的快捷键 ID。 */
  id: string;
  /** 面向用户的快捷键名称。 */
  title: string;
  /** 可接受多个等价按键组合。 */
  keys: string[];
  /** 快捷键所属的界面范围。 */
  scope: ShortcutScope;
  /** 是否应该出现在宿主的快捷键目录中。 */
  discoverable?: boolean;
  /** 冲突时的匹配优先级。 */
  priority?: ShortcutPriority;
  /** 额外的上下文匹配条件。 */
  when?: (context: ShortcutContext, event: KeyboardEvent) => boolean;
  /** 匹配后执行的动作；返回 false 允许继续匹配。 */
  run: (context: ShortcutContext, event: KeyboardEvent) => boolean | void | Promise<boolean | void>;
  /** 是否阻止浏览器默认行为，默认是。 */
  prevent_default?: boolean;
  /** 是否阻止事件继续冒泡，默认是。 */
  stop_propagation?: boolean;
};

export function detect_shortcut_platform(): ShortcutPlatform {
  if (typeof navigator === "undefined") return "mac";
  const platform = ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "").toLowerCase();
  if (platform.includes("mac")) return "mac";
  if (platform.includes("win")) return "windows";
  return "linux";
}

export function normalize_shortcut_key(key: string): string {
  const normalized_key = key.toLowerCase();
  return ({ esc: "escape", del: "delete", return: "enter", spacebar: "space", " ": "space" } as Record<string, string>)[normalized_key] || normalized_key;
}

export function shortcut_priority_value(priority: ShortcutPriority = "normal"): number {
  return ({ critical: 4, high: 3, normal: 2, low: 1 } as Record<ShortcutPriority, number>)[priority] || 0;
}

type KeyLikeEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export function matches_shortcut(event: KeyLikeEvent, shortcut: string, platform: ShortcutPlatform): boolean {
  let expected_key = "";
  const modifiers = { meta: false, ctrl: false, alt: false, shift: false };
  for (const token of shortcut.split("+").map((item) => normalize_shortcut_key(item.trim())).filter(Boolean)) {
    if (token === "mod") modifiers[platform === "mac" ? "meta" : "ctrl"] = true;
    else if (["meta", "cmd", "command"].includes(token)) modifiers.meta = true;
    else if (["ctrl", "control"].includes(token)) modifiers.ctrl = true;
    else if (["alt", "option"].includes(token)) modifiers.alt = true;
    else if (token === "shift") modifiers.shift = true;
    else expected_key = token;
  }
  return event.metaKey === modifiers.meta && event.ctrlKey === modifiers.ctrl && event.altKey === modifiers.alt && event.shiftKey === modifiers.shift && !!expected_key && normalize_shortcut_key(event.key) === expected_key;
}

export function format_shortcut_display(shortcut: string, platform: ShortcutPlatform): string {
  const tokens = shortcut.split("+").map((item) => normalize_shortcut_key(item.trim())).filter(Boolean).map((token) => {
    const symbols: Record<string, string> = platform === "mac" ? { mod: "⌘", meta: "⌘", cmd: "⌘", ctrl: "⌃", alt: "⌥", option: "⌥", shift: "⇧", enter: "↵", escape: "Esc", space: "␠" } : { mod: "Ctrl", meta: "Meta", cmd: "Meta", ctrl: "Ctrl", alt: "Alt", option: "Alt", shift: "Shift", enter: "Enter", escape: "Esc", space: "Space" };
    return symbols[token] || (token.length === 1 ? token.toUpperCase() : token);
  });
  return tokens.join(platform === "mac" ? "" : "+");
}
