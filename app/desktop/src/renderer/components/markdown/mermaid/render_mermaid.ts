/**
 * Desktop 的 Mermaid 渲染管线。
 *
 * 三件事在这里收口，缺一都会在真实会话里出问题：
 *
 * 1. **串行渲染**。`mermaid.initialize` 写的是模块级全局配置，`mermaid.render` 也共用同一个
 *    运行环境；长会话里一次挂载多张图时并发渲染会互相覆盖，出现串图或偶发解析失败。所有渲染
 *    进入同一条队列。
 * 2. **确定性 id**。Mermaid 默认用时间戳加随机串生成 id，同一条消息重渲染会不断生成新 id，
 *    留下残留节点。这里用「渲染位置 + 源码」的稳定散列，同一张图始终是同一个 id。
 * 3. **主题在渲染时读取**。配置不缓存：每次真正渲染时重新读取当前主题令牌，切换明暗模式后
 *    重渲染的图表直接跟随。
 */

import mermaid from "mermaid";
import { build_mermaid_config, read_mermaid_theme_tokens } from "@/components/markdown/mermaid/mermaid_theme";

/** 渲染 id 前缀；出现渲染残留时能在 DOM 里一眼认出是 Desktop 生成的图表。 */
const render_id_prefix = "downcity-mermaid";

let render_sequence = 0;
let render_queue: Promise<unknown> = Promise.resolve();

/** FNV-1a 散列；同一份输入在任何一次会话里都得到同一个字符串。 */
function stable_hash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** 把渲染位置收敛成合法的 id 片段。 */
function slugify_render_key(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** 让 SVG 跟随容器宽度，并留下可识别的标记。 */
function normalize_rendered_svg(svg: string): string {
  if (typeof window === "undefined") return svg;

  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const svg_element = parsed.querySelector("svg");
  if (!svg_element) return svg;

  svg_element.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg_element.setAttribute("data-mermaid-svg", "true");
  return new XMLSerializer().serializeToString(svg_element);
}

/** 立即渲染一次；只允许由 `render_mermaid_svg` 的队列调用。 */
async function render_mermaid_svg_now(source: string, render_key: string): Promise<string> {
  const render_key_slug = slugify_render_key(render_key) || `render-${(render_sequence += 1)}`;
  const render_hash = stable_hash(`${render_key}\u0000${source}`);
  const render_id = `${render_id_prefix}-${render_key_slug}-${render_hash}`;

  mermaid.initialize(build_mermaid_config(read_mermaid_theme_tokens(), `${render_key_slug}-${render_hash}`));

  const { svg } = await mermaid.render(render_id, source);
  return normalize_rendered_svg(svg);
}

/**
 * 把 Mermaid 源码渲染成归一化后的 SVG。
 *
 * `render_key` 标识渲染位置（通常是消息 id 与 part 序号）；它只影响生成的 id，不参与渲染结果。
 */
export async function render_mermaid_svg(source: string, render_key: string): Promise<string> {
  const render_task = render_queue.then(() => render_mermaid_svg_now(source, render_key));
  // 队列自身必须吞掉失败，否则一次错误会让后续所有图表都无法渲染。
  render_queue = render_task.then(
    () => undefined,
    () => undefined,
  );
  return render_task;
}
