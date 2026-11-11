/**
 * MarkdownView 中的 Mermaid 图表块，宿主翻译与流式状态由公共上下文提供。
 *
 * 三种状态各有明确的呈现：渲染中只占位，渲染成功进入可交互的画布，流式结束仍失败才退回源码。
 * 四个决定值得单独说明：
 *
 * 1. **持续可见性调度**。进入视口及其上下 320px 范围才加载 Pele、测量宽度并渲染；
 *    离开后断开宽度观察、取消待执行任务，保留最后宽度与 SVG，返回时按当前输入补算。
 *    IntersectionObserver 不可用时立即渲染；静态导出始终绕过可见性与流式等待。
 * 2. **重新渲染期间保留上一张图**。流式生成时源码每个 chunk 都在变，若每次都先清空，图表会在
 *    「出现 → 消失」之间反复。旧图一直留到新的渲染成功，确定失败才撤下。
 * 3. **失败只在生成结束后算数**。流式中的围栏本来就可能是半截语法，此时一律显示渲染中；
 *    等这一轮生成结束（会再渲染一次）仍失败，才显示可读原因并把源码还原成代码块。
 * 4. **布局与主题分离**。Pele 按可用宽度和字体布局，颜色通过 CSS 变量直接跟随主题。
 *    ResizeObserver 仅在附近观察宽度；字体事件可以清理已加载引擎的缓存，但离屏不测量或重排。
 *    已开始的模块下载无法取消，完成后仍须检查任务与可见性，避免过期结果写回。
 *
 * React 持有 SVG 节点，不启用 Pele 的内置缩放或挂载器。实例标识用于隔离 SVG 内部引用，
 * 布局缓存独立于实例，分段离屏回收后仍可复用。全屏与下载从真实画布读取主题与字体。
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { TriangleAlert as TbAlertTriangle, Check as TbCheck, Copy as TbCopy, Maximize as TbMaximize } from "lucide-react";
import { use_markdown_streaming } from "../markdown_stream_context";
import { use_markdown_export } from "../markdown_export_context";
import { MermaidFullscreen } from "./MermaidFullscreen";
import { mermaid_action_button_class_name } from "./mermaid_styles";
import { use_document_theme_revision } from "../use_document_theme_revision";
import { use_markdown_translation } from "../markdown_host_context";

/** 仅缓存动态加载的模块，不让挂载在远处的图表提前加载 Pele。 */
let loaded_mermaid_renderer: typeof import("./render_mermaid") | undefined;

/** 动态导入由模块系统合并；加载失败不缓存，显式重试可再次加载。 */
async function load_mermaid_renderer() {
  loaded_mermaid_renderer ??= await import("./render_mermaid");
  return loaded_mermaid_renderer;
}

/** 视口上下各提前 320px；离开该范围即暂停布局。 */
const render_root_margin = "320px";

/** 流式生成中的重渲染抖动间隔：同一张图随每个 chunk 变化时不必每次都真的渲染一次。 */
const streaming_render_delay = 200;

/** 复制反馈的保持时长。 */
const copied_feedback_duration = 1600;

/** 合并受控节点树里的文本子节点；图表源码由 rehype 转换以文本子节点写入。 */
function read_diagram_source(children: ReactNode): string {
  if (typeof children === "string") return children.trim();
  if (Array.isArray(children)) {
    return children
      .filter((child): child is string => typeof child === "string")
      .join("")
      .trim();
  }
  return "";
}

export function MermaidDiagram({ children }: { /** rehype 转换写入的图表源码。 */ children?: ReactNode }) {
  const source = useMemo(() => read_diagram_source(children), [children]);
  const export_mode = use_markdown_export();
  const streaming = use_markdown_streaming() && !export_mode;
  const has_source = source.length > 0;
  const translate = use_markdown_translation();
  const instance_id = useId();
  const render_id = `downcity-pele-${instance_id.replace(/[^a-zA-Z0-9_-]/g, "")}-`;
  const container_ref = useRef<HTMLDivElement>(null);
  const canvas_ref = useRef<HTMLDivElement>(null);
  // 订阅真实宿主及祖先主题，嵌套 ThemeContainer 同样会刷新字体和全屏令牌。
  const theme_revision = use_document_theme_revision(container_ref);
  // IO 回调先更新 ref，再提交状态；排队的 RO / import 回调也能立即识别离屏。
  const render_active_ref = useRef(export_mode);
  const measured_width_ref = useRef(0);
  const [available_width, set_available_width] = useState(0);
  const [font_revision, set_font_revision] = useState(0);
  const [visible, set_visible] = useState(export_mode);
  const [svg, set_svg] = useState("");
  const [failed, set_failed] = useState(false);
  const [attempt, set_attempt] = useState(0);
  const [copied, set_copied] = useState(false);
  const [fullscreen, set_fullscreen] = useState(false);

  useEffect(() => {
    const element = container_ref.current;
    if (!element) return;
    let cancelled = false;
    const update_visibility = (near_viewport: boolean) => {
      if (cancelled) return;
      render_active_ref.current = near_viewport;
      set_visible(near_viewport);
    };
    // 导出树固定挂在视口外，必须直接生成 SVG，供归档等待器判断是否就绪。
    if (export_mode || typeof IntersectionObserver === "undefined") {
      update_visibility(true);
      return () => {
        cancelled = true;
        render_active_ref.current = false;
      };
    }

    update_visibility(false);
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) update_visibility(entry.isIntersecting);
      },
      { rootMargin: render_root_margin },
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      render_active_ref.current = false;
      observer.disconnect();
    };
  }, [export_mode, has_source]);

  useEffect(() => {
    const container = container_ref.current;
    const canvas = canvas_ref.current;
    if (!container || !canvas || !visible || !render_active_ref.current) return;
    let cancelled = false;
    const measure_width = () => {
      if (cancelled || !render_active_ref.current) return;
      const style = getComputedStyle(canvas);
      // 首次渲染前画布处于 hidden 状态，用外壳内容宽度测量，避免得到 0 后无法启动。
      const width = container.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      measured_width_ref.current = Math.max(0, Math.floor(width));
      set_available_width(measured_width_ref.current);
    };
    // 每次返回先同步测量；渲染任务不能拿离屏前的旧宽度先画一次。
    measure_width();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure_width);
      return () => {
        cancelled = true;
        window.removeEventListener("resize", measure_width);
      };
    }
    const observer = new ResizeObserver(measure_width);
    observer.observe(container);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [export_mode, has_source, visible, theme_revision]);

  useEffect(() => {
    let cancelled = false;
    const fonts = document.fonts;
    const refresh_fonts = () => {
      if (cancelled) return;
      loaded_mermaid_renderer?.invalidate_mermaid_fonts();
      set_font_revision((current) => current + 1);
    };
    // ready 覆盖首次挂载时正在加载的字体，loadingdone 覆盖后续用户切换字体的情况。
    if (fonts.status === "loading") void fonts.ready.then(refresh_fonts);
    fonts.addEventListener("loadingdone", refresh_fonts);
    return () => {
      cancelled = true;
      fonts.removeEventListener("loadingdone", refresh_fonts);
    };
  }, []);

  // 重新渲染期间保留上一张图，避免流式生成时每个 chunk 都把图表打回占位再重画。
  // 只有渲染失败才撤下它——那时旧结果已经不属于当前源码，视图退回源码更诚实。
  useEffect(() => {
    if (!visible || !render_active_ref.current || !source || available_width <= 0) return;
    let cancelled = false;
    const is_current = () => !cancelled && render_active_ref.current && available_width === measured_width_ref.current;
    const render_diagram = async () => {
      if (!is_current()) return;
      try {
        const renderer = await load_mermaid_renderer();
        const canvas = canvas_ref.current;
        if (!is_current() || !canvas) return;
        set_svg(renderer.render_mermaid_svg(source, available_width, canvas, render_id));
        set_failed(false);
      } catch {
        if (!is_current()) return;
        set_failed(true);
        // 半截语法保留最后一次成功图表，生成结束仍失败才回退到源码。
        if (!streaming) set_svg("");
      }
    };
    const timer = window.setTimeout(() => void render_diagram(), streaming ? streaming_render_delay : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [attempt, available_width, export_mode, font_revision, render_id, source, streaming, theme_revision, visible]);

  const copy_source = useCallback(async () => {
    if (!source) return;
    await navigator.clipboard.writeText(source);
    set_copied(true);
    window.setTimeout(() => set_copied(false), copied_feedback_duration);
  }, [source]);

  if (!source) return null;

  // 流式生成中的围栏本来就可能是半截语法，此时不把失败当真：显示渲染中，
  // 等这一轮生成结束（streaming 变假会重跑一次渲染）再决定是呈现图表还是回退到源码。
  const state = svg ? "rendered" : failed && !streaming ? "failed" : "pending";

  return (
    <div ref={container_ref} className="markdown-mermaid" data-mermaid-state={state} data-chat-retain-interaction={fullscreen ? "" : undefined}>
      <div ref={canvas_ref} className="markdown-mermaid-canvas" hidden={!svg} dangerouslySetInnerHTML={{ __html: svg }} />
      {svg ? (
        <>
          <div className="markdown-mermaid-toolbar">
            <button
              type="button"
              className={mermaid_action_button_class_name}
              title={translate(copied ? "mermaid.copied" : "mermaid.copy_source")}
              aria-label={translate("mermaid.copy_source")}
              onClick={() => void copy_source()}
            >
              {copied ? <TbCheck aria-hidden /> : <TbCopy aria-hidden />}
            </button>
            <button type="button" className={mermaid_action_button_class_name} title={translate("mermaid.fullscreen")} aria-label={translate("mermaid.fullscreen")} onClick={() => set_fullscreen(true)}>
              <TbMaximize aria-hidden />
            </button>
          </div>
        </>
      ) : state === "pending" ? (
        <div className="markdown-mermaid-pending" role={visible ? "status" : undefined} aria-label={visible ? translate("mermaid.rendering") : undefined}>
          {visible ? <span className="markdown-mermaid-spinner" aria-hidden /> : null}
        </div>
      ) : null}

      {state === "failed" ? (
        <div className="markdown-mermaid-fallback">
          <div className="markdown-mermaid-status" role="alert">
            <TbAlertTriangle aria-hidden />
            <span className="markdown-mermaid-status-text">{translate("mermaid.render_failed")}</span>
            <button
              type="button"
              className={`${mermaid_action_button_class_name} markdown-mermaid-retry`}
              onClick={() => {
                // 重试是用户的显式动作，先回到渲染中，让这次尝试有反馈。
                set_failed(false);
                set_attempt((current) => current + 1);
              }}
            >
              {translate("mermaid.retry")}
            </button>
          </div>
          <div className="markdown-mermaid-source">{source}</div>
        </div>
      ) : null}

      {fullscreen && svg ? <MermaidFullscreen svg={svg} theme_source_ref={canvas_ref} on_close={() => set_fullscreen(false)} /> : null}
    </div>
  );
}
