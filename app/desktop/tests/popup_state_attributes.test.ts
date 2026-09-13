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
    "features/plugin/lib/PluginRendererComponents.tsx",
  ].map((relative_path) => ({ relative_path, source: fs.readFileSync(path.join(renderer_root, relative_path), "utf8") }));
  for (const { relative_path, source } of trigger_sources) {
    assert.match(source, /data-\[popup-open\]:/, `${relative_path} 应使用 data-[popup-open] 表达触发器展开态`);
  }
});
