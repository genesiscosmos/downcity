/**
 * Renderer 弹层状态属性契约测试。
 *
 * 全仓弹层原语（dropdown / select / dialog / popover）都基于 Base UI。Base UI 在触发器上只设置
 * `data-popup-open`；它从不设置 `data-state`。写成 `data-[state=open]` 不会报错、不会警告，
 * 只是永远不匹配——后果是菜单展开时入口消失、选中态不生效。这类错误无法靠类型系统发现，
 * 因此在源码层面加一道护栏。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const renderer_root = path.resolve(import.meta.dirname, "../src/renderer");

/** 递归收集 Renderer 下的全部 TS/TSX 源文件。 */
function list_renderer_sources(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entry_path = path.join(directory, entry.name);
    if (entry.isDirectory()) return list_renderer_sources(entry_path);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [entry_path] : [];
  });
}

test("Renderer 不使用 Base UI 不存在的 data-state 选择器", () => {
  const offenders = list_renderer_sources(renderer_root).flatMap((file_path) => {
    const source = fs.readFileSync(file_path, "utf8");
    // `data-state=...` 作为 Tailwind 变体（含 group- / peer- 前缀）都不成立。
    return /(?:^|[\s"'`])[a-z-]*data-\[state=/.test(source) ? [path.relative(renderer_root, file_path)] : [];
  });
  assert.deepEqual(offenders, [], `这些文件使用了 Base UI 不设置的 data-state 变体，应改用 data-popup-open：\n${offenders.join("\n")}`);
});

test("弹层触发器识别到的是 data-popup-open", () => {
  const trigger_sources = [
    "components/ui/button.tsx",
    "features/power/lib/PowerRendererComponents.tsx",
  ].map((relative_path) => ({ relative_path, source: fs.readFileSync(path.join(renderer_root, relative_path), "utf8") }));
  for (const { relative_path, source } of trigger_sources) {
    assert.match(source, /data-\[popup-open\]:/, `${relative_path} 应使用 data-[popup-open] 表达触发器展开态`);
  }
});

/**
 * `DropdownMenuLabel` 必须住在 `DropdownMenuGroup` 里。
 *
 * 它就是 Base UI 的 `Menu.GroupLabel`，而那个组件会去读 `MenuGroupContext`；
 * 不包在 Group 里时它**不会报警告、也不会被类型系统拦住**，而是在菜单打开的那一刻直接抛
 * `MenuGroupContext is missing`——整个菜单炸掉。因此只能在源码层面拦。
 *
 * 判据是「同一个内容块里，每个 Label 之前都有未闭合的 Group」。不解析 JSX，
 * 只按开合标签计数——对菜单内容这种浅结构足够，而多层嵌套本来也不该出现在菜单里。
 */
test("DropdownMenuLabel 必须包在 DropdownMenuGroup 里", () => {
  const offenders = list_renderer_sources(renderer_root).flatMap((file_path) => {
    const source = fs.readFileSync(file_path, "utf8");
    const relative_path = path.relative(renderer_root, file_path);
    // 原语自身不算：它只是把 Base UI 的部件转出来，用法约束属于调用点。
    if (relative_path === "components/ui/dropdown.tsx") return [];
    const labels = [...source.matchAll(/<DropdownMenuLabel\b/g)].map((match) => match.index ?? 0);
    if (labels.length === 0) return [];
    const groups = [...source.matchAll(/<\/?DropdownMenuGroup\b/g)]
      .map((match) => ({ index: match.index ?? 0, closing: match[0].startsWith("</") }));
    // 对每个 Label，往左数：未闭合的 Group 必须为正。
    const unclosed = labels.filter((label_index) => {
      let depth = 0;
      for (const group of groups) {
        if (group.index > label_index) break;
        depth += group.closing ? -1 : 1;
      }
      return depth <= 0;
    });
    return unclosed.length > 0 ? [relative_path] : [];
  });
  assert.deepEqual(offenders, [], `这些文件里的 DropdownMenuLabel 不在 DropdownMenuGroup 内：打开菜单时会抛 MenuGroupContext is missing\n${offenders.join("\n")}`);
});
