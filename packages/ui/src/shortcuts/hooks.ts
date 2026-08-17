/** 快捷键注册 React Hook。 */
import { useEffect, type DependencyList } from "react";
import { register_shortcuts } from "./registry";
import type { ShortcutDefinition } from "./types";

export function use_register_shortcuts(factory: () => ShortcutDefinition[], dependencies: DependencyList): void {
  useEffect(() => register_shortcuts(factory()), dependencies);
}
