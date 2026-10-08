/**
 * 把 ui-sdk-docs 的组件示例块替换为实时预览。
 *
 * 背景：43 个组件页在两种语言下各有一份，逐页手改既慢又容易不一致。这里按「组件页 →
 * 预览名」的映射，把每页「最小示例」小节里的第一个 ```tsx 代码块替换为
 * `<ComponentPreview name="…" />`，其余代码块保持原样（它们是用法说明而非完整示例）。
 *
 * 幂等：已经替换过的页面不会再次替换，重复执行安全。
 *
 * 用法：node scripts/apply-component-previews.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const homepage_root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 组件页到预览名的映射。
 *
 * 预览名对应 `app/components/docs/previews/<name>.tsx`，键是内容目录下的文件名。
 */
const component_previews = {
  button: "button-basic",
  "button-group": "button-group",
  badge: "badge",
  card: "card",
  checkbox: "checkbox",
  input: "input",
  textarea: "textarea",
  select: "select",
  slider: "slider",
  switch: "switch",
  tabs: "tabs",
  toggle: "toggle",
  "toggle-group": "toggle",
  spinner: "spinner",
  skeleton: "skeleton",
  separator: "separator",
  kbd: "kbd",
  item: "item",
  empty: "empty",
  command: "command",
  dialog: "dialog",
  "dropdown-menu": "dropdown-menu",
  popover: "popover",
  tooltip: "tooltip",
  sheet: "sheet",
  settings: "settings",
  typography: "typography",
  "code-block": "code-block",
  "form-field": "form-field",
};

/** 插入位置：优先「最小示例 / Basic Example」，否则回退到「导入 / Import」之后的第一个代码块。 */
const example_headings = ["## 最小示例", "## Basic Example"];

/** 尚未被替换的 tsx 代码块。 */
const tsx_block_pattern = /```tsx\n[\s\S]*?```\n/;

/**
 * 在正文中定位第一个示例代码块并替换为预览组件。
 *
 * 返回替换后的文本；找不到目标代码块时返回原文本，便于统计未命中的页面。
 */
function replace_example_block(source, preview_name) {
  if (source.includes("<ComponentPreview")) return { source, replaced: false };

  let search_start = 0;
  for (const heading of example_headings) {
    const heading_index = source.indexOf(heading);
    if (heading_index >= 0) {
      search_start = heading_index;
      break;
    }
  }

  const remainder = source.slice(search_start);
  const match = remainder.match(tsx_block_pattern);
  if (!match) return { source, replaced: false };

  const replaced_block = `<ComponentPreview name="${preview_name}" />\n`;
  const next = source.slice(0, search_start) + remainder.replace(tsx_block_pattern, replaced_block);

  return { source: next, replaced: true };
}

/** 处理一种语言下的全部组件页。 */
async function apply_locale(locale) {
  const directory = join(homepage_root, "content", "ui-sdk-docs", locale, "components");
  const results = [];

  for (const [page, preview_name] of Object.entries(component_previews)) {
    const file_path = join(directory, `${page}.mdx`);

    let source;
    try {
      source = await readFile(file_path, "utf-8");
    } catch {
      results.push(`${locale}/${page}: missing`);
      continue;
    }

    const outcome = replace_example_block(source, preview_name);
    if (!outcome.replaced) {
      results.push(`${locale}/${page}: skipped`);
      continue;
    }

    await writeFile(file_path, outcome.source, "utf-8");
    results.push(`${locale}/${page}: ok`);
  }

  return results;
}

const results = [...(await apply_locale("en")), ...(await apply_locale("zh"))];
const applied = results.filter((line) => line.endsWith("ok")).length;
const skipped = results.filter((line) => line.endsWith("skipped")).length;

console.log(`[component-previews] 已替换 ${applied} 个页面，跳过 ${skipped} 个`);
for (const line of results) {
  if (!line.endsWith("ok")) console.log(`  ${line}`);
}
