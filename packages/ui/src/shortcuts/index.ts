/** 快捷键模块公开导出。 */
export { get_shortcut_context } from "./context";
export { ShortcutProvider } from "./provider";
export { list_registered_shortcut_definitions, list_registered_shortcuts, register_shortcuts } from "./registry";
export { detect_shortcut_platform, format_shortcut_display, matches_shortcut, normalize_shortcut_key, shortcut_priority_value } from "./types";
export { use_register_shortcuts } from "./hooks";
export type { ShortcutContext, ShortcutDefinition, ShortcutFocus, ShortcutPlatform, ShortcutPriority, ShortcutScope } from "./types";
