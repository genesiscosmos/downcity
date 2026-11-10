/**
 * MarkdownView 的 Mermaid 全屏查看与局部主题隔离。
 *
 * 图表在消息流里只能按列宽展示，密集的时序图、状态图在那个宽度下基本没法读。全屏层负责
 * 与编辑器一致的一组操作：滚轮缩放、拖拽平移、一键回到适应窗口、导出 PNG，以及 ESC 退出。
 *
 * 这里只消费内联视图已经渲染好的 Pele SVG，不重新布局。主题通过 CSS 变量跟随，
 * 下载时从当前 SVG 读取样式快照，使独立 PNG 保留全屏中看到的颜色与字体。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Download as TbDownload, RotateCcw as TbRestore, X as TbX, ZoomIn as TbZoomIn, ZoomOut as TbZoomOut } from "lucide-react";
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import { download_mermaid_png, read_mermaid_svg_size } from "./mermaid_image";
import { mermaid_overlay_button_class_name } from "./mermaid_styles";
import { read_mermaid_overlay_style } from "./mermaid_theme";
import { use_document_theme_revision } from "../use_document_theme_revision";
import { use_markdown_translation } from "../markdown_host_context";

/** 缩放的单步幅度与动画时长。 */
const zoom_step = 0.25;
const zoom_animation_time = 160;

/** 把 Tab 循环限制在全屏层内，否则焦点会跑到被遮住的消息流里。 */
function trap_focus(event: KeyboardEvent, container: HTMLElement): void {
  if (event.key !== "Tab") return;
  const focusable = [...container.querySelectorAll<HTMLElement>("button:not([disabled])")];
  if (focusable.length === 0) return;

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement;

  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function MermaidFullscreen({ svg, theme_source_ref, on_close }: {
  /** 已渲染完成的图表 SVG。 */
  svg: string;
  /** 正文图表的画布；Portal 从真实宿主捕获局部主题和字体。 */
  theme_source_ref: RefObject<HTMLElement | null>;
  /** 关闭全屏并恢复打开前的焦点。 */
  on_close(): void;
}) {
  const translate = use_markdown_translation();
  const theme_revision = use_document_theme_revision(theme_source_ref);
  const overlay_style = useMemo(() => read_mermaid_overlay_style(theme_source_ref.current), [svg, theme_revision, theme_source_ref]);
  const container_ref = useRef<HTMLDivElement>(null);
  const transform_ref = useRef<ReactZoomPanPinchContentRef | null>(null);
  const canvas_ref = useRef<HTMLDivElement>(null);
  const [download_failed, set_download_failed] = useState(false);
  // 缩放层需要一个确定尺寸的内容才能计算适配；尺寸取自 SVG 自己的 viewBox。
  const svg_size = useMemo(() => read_mermaid_svg_size(svg), [svg]);

  useEffect(() => {
    // 打开即接管键盘焦点，Tab 从缩放控件开始；关闭时把焦点还给打开它的按钮，
    // 否则键盘用户回到消息流时已经丢掉了位置。
    const previous_focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    container_ref.current?.focus();
    return () => previous_focus?.focus();
  }, []);

  useEffect(() => {
    const handle_key_down = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        on_close();
        return;
      }
      if (container_ref.current) trap_focus(event, container_ref.current);
    };
    document.addEventListener("keydown", handle_key_down);
    return () => document.removeEventListener("keydown", handle_key_down);
  }, [on_close]);

  const zoom_in = useCallback(() => void transform_ref.current?.zoomIn(zoom_step, zoom_animation_time), []);
  const zoom_out = useCallback(() => void transform_ref.current?.zoomOut(zoom_step, zoom_animation_time), []);
  const fit_to_view = useCallback(() => void transform_ref.current?.fitToView({ mode: "contain" }), []);

  const download = useCallback(async () => {
    set_download_failed(false);
    try {
      const svg_element = canvas_ref.current?.querySelector("svg");
      if (!svg_element) throw new Error("Diagram is unavailable");
      await download_mermaid_png(svg_element, "mermaid-diagram.png");
    } catch {
      set_download_failed(true);
    }
  }, []);

  return createPortal(
    <div ref={container_ref} className="markdown-mermaid-overlay markdown-mermaid-fullscreen" style={overlay_style} role="dialog" aria-modal="true" aria-label={translate("mermaid.diagram")} tabIndex={-1}>
      <TransformWrapper
        ref={transform_ref}
        initialScale={1}
        minScale={0.05}
        maxScale={8}
        limitToBounds={false}
        centerOnInit={false}
        fitOnInit="contain"
        doubleClick={{ disabled: true }}
        wheel={{ step: 0.08 }}
        panning={{ velocityDisabled: true }}
      >
        <TransformComponent
          wrapperStyle={{ width: "100%", height: "100%" }}
          contentStyle={svg_size ? { width: svg_size.width, height: svg_size.height } : undefined}
        >
          <div
            ref={canvas_ref}
            className="markdown-mermaid-fullscreen-canvas"
            style={svg_size ? { width: svg_size.width, height: svg_size.height } : undefined}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </TransformComponent>
      </TransformWrapper>

      <div className="markdown-mermaid-float is-actions">
        <button type="button" className={mermaid_overlay_button_class_name} title={translate("mermaid.download_png")} aria-label={translate("mermaid.download_png")} onClick={() => void download()}>
          <TbDownload aria-hidden />
        </button>
        <button type="button" className={mermaid_overlay_button_class_name} title={translate("mermaid.exit_fullscreen")} aria-label={translate("mermaid.exit_fullscreen")} onClick={on_close}>
          <TbX aria-hidden />
        </button>
      </div>

      <div className="markdown-mermaid-float is-zoom">
        <button type="button" className={mermaid_overlay_button_class_name} title={translate("mermaid.zoom_in")} aria-label={translate("mermaid.zoom_in")} onClick={zoom_in}>
          <TbZoomIn aria-hidden />
        </button>
        <button type="button" className={mermaid_overlay_button_class_name} title={translate("mermaid.zoom_out")} aria-label={translate("mermaid.zoom_out")} onClick={zoom_out}>
          <TbZoomOut aria-hidden />
        </button>
        <button type="button" className={mermaid_overlay_button_class_name} title={translate("mermaid.fit")} aria-label={translate("mermaid.fit")} onClick={fit_to_view}>
          <TbRestore aria-hidden />
        </button>
      </div>

      {download_failed ? (
        <p className="markdown-mermaid-download-error" role="alert">
          {translate("mermaid.download_failed")}
        </p>
      ) : null}
    </div>,
    document.body,
  );
}
