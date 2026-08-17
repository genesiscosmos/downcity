/** 快捷键注册表，负责注册、排序和订阅快捷键定义。 */
import { shortcut_priority_value, type ShortcutDefinition } from "./types";

type ShortcutEntry = { definition: ShortcutDefinition; order: number };
const entries = new Map<string, ShortcutEntry>();
let registration_order = 0;

export function register_shortcuts(definitions: ShortcutDefinition[]): () => void {
  const ids: string[] = [];
  for (const definition of definitions) {
    entries.set(definition.id, { definition, order: registration_order++ });
    ids.push(definition.id);
  }
  return () => { for (const id of ids) entries.delete(id); };
}

export function list_registered_shortcuts(): ShortcutEntry[] {
  return [...entries.values()].sort((left, right) => shortcut_priority_value(right.definition.priority) - shortcut_priority_value(left.definition.priority) || right.order - left.order);
}

export function list_registered_shortcut_definitions(): ShortcutDefinition[] {
  return list_registered_shortcuts().map((entry) => entry.definition);
}
