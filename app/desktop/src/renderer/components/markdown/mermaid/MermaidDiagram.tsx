/**
 * Markdown 中的 Mermaid 图表块。
 *
 * 三种状态各有明确的呈现：渲染中只占位，渲染成功进入可交互的画布，渲染失败退回源码。
 * 三个决定值得单独说明：
 *
 * 1. **懒渲染**。长会话可能带上十几张图，一次性渲染会卡住首屏；滚动到附近才开始渲染。
 * 2. **失败即源码**。图表渲染失败时不再显示红色错误块，而是把它还原成代码块——用户至少能
 *    拿到原始源码。流式生成中的围栏本来就可能是半截语法，此时连失败提示都不显示，等这一轮
 *    生成结束再由失败态决定要不要报错。
 * 3. **主题跟随**。渲染用的主题在渲染那一刻读取，因此明暗模式或主题切换后重新渲染的图表
 *    直接跟随；切换主题时不会为此重建整棵消息树。
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { TbAlertTriangle, TbCheck, TbCopy, TbMaximize } from "react-icons/tb";
import { use_markdown_streaming } from "@/components/markdown/markdown_stream_context";
import { MermaidFullscreen } from "@/components/markdown/mermaid/MermaidFullscreen";
import { render_mermaid_svg } from "@/components/markdown/mermaid/render_mermaid";
import { mermaid_action_button_class_name } from "@/components/markdown/mermaid/mermaid_styles";
import { use_document_theme_revision } from "@/hooks/use_document_theme_revision";
import { use_translation } from "@/locales/i18n";

/** 提前于视口的渲染范围；留出一屏左右的距离，滚动时图表已经就绪。 */
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
  const streaming = use_markdown_streaming();
  // 主题写在 <html> 上，不是 React 状态；主题变化时重渲染才能拿到新令牌。
  const theme_revision = use_document_theme_revision();
  const translate = use_translation("markdown");
  const render_key = useId();
  const container_ref = useRef<HTMLDivElement>(null);
  const [visible, set_visible] = useState(false);
  const [svg, set_svg] = useState("");
  const [failed, set_failed] = useState(false);
  const [attempt, set_attempt] = useState(0);
  const [copied, set_copied] = useState(false);
  const [fullscreen, set_fullscreen] = useState(false);

  useEffect(() => {
    const element = container_ref.current;
    if (!element || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      set_visible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        set_visible(true);
        observer.disconnect();
      },
      { rootMargin: render_root_margin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  // 源码变化时收起上一张图：旧结果属于旧源码，不能继续当成当前图表展示。
  // 反过来，流式状态变化不代表内容变过，所以不在这里清空——否则每条消息结束生成时，
  // 里面所有图表都会先闪回占位再重新出现。
  useEffect(() => {
    set_svg("");
    set_failed(false);
  }, [source]);

  useEffect(() => {
    if (!visible || !source) return;

    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        void render_mermaid_svg(source, render_key).then(
          (rendered) => {
            if (!cancelled) set_svg(rendered);
          },
          () => {
            if (!cancelled) set_failed(true);
          },
        );
      },
      streaming ? streaming_render_delay : 0,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [attempt, render_key, source, streaming, theme_revision, visible]);

  const copy_source = useCallback(async () => {
    if (!source) return;
    await navigator.clipboard.writeText(source);
    set_copied(true);
    window.setTimeout(() => set_copied(false), copied_feedback_duration);
  }, [source]);

  if (!source) return null;

  const state = svg ? "rendered" : failed ? "failed" : "pending";

  return (
    <div ref={container_ref} className="markdown-mermaid" data-mermaid-state={state}>
      {svg ? (
        <>
          <div className="markdown-mermaid-canvas" dangerouslySetInnerHTML={{ __html: svg }} />
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
      ) : (
        <div className="markdown-mermaid-pending" role={visible ? "status" : undefined} aria-label={visible ? translate("mermaid.rendering") : undefined}>
          {visible ? <span className="markdown-mermaid-spinner" aria-hidden /> : null}
        </div>
      )}

      {state === "failed" ? (
        <div className="markdown-mermaid-fallback">
          {streaming ? null : (
            <div className="markdown-mermaid-status" role="alert">
              <TbAlertTriangle aria-hidden />
              <span className="markdown-mermaid-status-text">{translate("mermaid.render_failed")}</span>
              <button type="button" className={`${mermaid_action_button_class_name} markdown-mermaid-retry`} onClick={() => set_attempt((current) => current + 1)}>
                {translate("mermaid.retry")}
              </button>
            </div>
          )}
          <div className="markdown-mermaid-source">{source}</div>
        </div>
      ) : null}

      {fullscreen && svg ? <MermaidFullscreen svg={svg} on_close={() => set_fullscreen(false)} /> : null}
    </div>
  );
}
