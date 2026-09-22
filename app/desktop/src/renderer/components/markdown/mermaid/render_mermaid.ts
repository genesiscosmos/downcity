/**
 * Desktop 的 Mermaid 渲染管线。
 *
 * 四件事在这里收口，缺一都会在真实会话里出问题：
 *
 * 1. **串行渲染**。`mermaid.initialize` 写的是模块级全局配置，`mermaid.render` 也共用同一个
 *    运行环境；长会话里一次挂载多张图时并发渲染会互相覆盖，出现串图或偶发解析失败。所有渲染
 *    进入同一条队列。
 * 2. **按内容缓存结果**。同一份源码 + 同一套主题令牌只会真正渲染一次，之后直接复用 SVG。
 *    分段离屏回收会卸载并重建图表组件，没有缓存时每次滚回来都要重跑一遍 mermaid（含 dagre 布局）。
 * 3. **确定性 id**。Mermaid 默认用时间戳加随机串生成 id；同一张图重渲染会不断生成新 id，
 *    留下残留节点。这里用源码与主题令牌的稳定散列，同一张图始终是同一个 id。
 *    id 里不含渲染位置：位置标识随组件重挂载而变，而它只用于 Mermaid 内部的临时节点清理，
 *    结果正确性不依赖它。
 * 4. **主题在渲染时读取**。配置不缓存：每次真正渲染时重新读取当前主题令牌，切换明暗模式后
 *    重渲染的图表直接跟随；主题令牌参与缓存键，因此切主题会得到新的渲染结果。
 */

import { build_mermaid_config, read_mermaid_theme_tokens } from "@/components/markdown/mermaid/mermaid_theme";

/** 渲染 id 前缀；出现渲染残留时能在 DOM 里一眼认出是 Desktop 生成的图表。 */
const render_id_prefix = "downcity-mermaid";

/** 已渲染结果的缓存上限。图表 SVG 体积可观，按最近使用淘汰。 */
const render_cache_limit = 32;

let render_queue: Promise<unknown> = Promise.resolve();

/** 进程内共享的 Mermaid 模块；加载开销大且初始化会写全局配置，必须复用同一份。 */
let mermaid_promise: Promise<typeof import("mermaid")> | undefined;

/** 已渲染结果；键为源码与主题令牌的散列。Map 保持插入顺序，据此实现 LRU。 */
const render_cache = new Map<string, string>();

/** 惰性加载 Mermaid；首次调用触发，之后复用同一份模块。 */
function get_mermaid(): Promise<typeof import("mermaid")> {
  mermaid_promise ??= import("mermaid").catch((reason: unknown) => {
    // 加载失败时清掉缓存，下次渲染可以重新尝试，而不是整个会话都无法画图。
    mermaid_promise = undefined;
    throw reason;
  });
  return mermaid_promise;
}

/** FNV-1a 散列；同一份输入在任何一次会话里都得到同一个字符串。 */
function stable_hash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * 由图表源码派生稳定标识。
 *
 * 图表组件在分段离屏回收后会重新挂载，而渲染预算与 Mermaid 的确定性 id 都需要一个跨重挂载
 * 不变的标识；源码是唯一在重挂载后仍然相同的输入。
 */
export function hash_mermaid_source(source: string): string {
  return stable_hash(source);
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
async function render_mermaid_svg_now(source: string, theme_seed: string): Promise<string> {
  const render_hash = stable_hash(`${theme_seed}\u0000${source}`);
  const render_id = `${render_id_prefix}-${render_hash}`;

  const { default: mermaid } = await get_mermaid();
  mermaid.initialize(build_mermaid_config(read_mermaid_theme_tokens(), render_hash));

  const { svg } = await mermaid.render(render_id, source);
  return normalize_rendered_svg(svg);
}

/** 读取缓存并把它移到最近使用位置。 */
function read_cached_render(cache_key: string): string | undefined {
  const cached = render_cache.get(cache_key);
  if (cached === undefined) return undefined;
  render_cache.delete(cache_key);
  render_cache.set(cache_key, cached);
  return cached;
}

/** 写入缓存并按上限淘汰最久未使用的一项。 */
function write_cached_render(cache_key: string, svg: string): void {
  render_cache.set(cache_key, svg);
  while (render_cache.size > render_cache_limit) {
    const oldest = render_cache.keys().next().value;
    if (oldest === undefined) break;
    render_cache.delete(oldest);
  }
}

/**
 * 把 Mermaid 源码渲染成归一化后的 SVG。
 *
 * 结果按「源码 + 当前主题令牌」缓存：同一张图反复进出视口（分段回收会卸载并重建组件）时
 * 直接复用，不重新跑 mermaid。主题令牌参与缓存键，因此切换明暗模式会得到新的渲染结果。
 */
export async function render_mermaid_svg(source: string): Promise<string> {
  const theme_seed = stable_hash(JSON.stringify(read_mermaid_theme_tokens()));
  const cache_key = `${theme_seed}\u0000${source}`;
  const cached = read_cached_render(cache_key);
  if (cached !== undefined) return cached;

  const render_task = render_queue.then(() => render_mermaid_svg_now(source, theme_seed));
  // 队列自身必须吞掉失败，否则一次错误会让后续所有图表都无法渲染。
  render_queue = render_task.then(
    () => undefined,
    () => undefined,
  );
  const svg = await render_task;
  write_cached_render(cache_key, svg);
  return svg;
}
