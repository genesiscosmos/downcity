/**
 * Markdown 中的 Mermaid 图表块。
 *
 * 三种状态各有明确的呈现：渲染中只占位，渲染成功进入可交互的画布，流式结束仍失败才退回源码。
 * 四个决定值得单独说明：
 *
 * 1. **懒渲染**。长会话可能带上十几张图，一次性渲染会卡住首屏；滚动到附近才开始渲染。
 * 2. **重新渲染期间保留上一张图**。流式生成时源码每个 chunk 都在变，若每次都先清空，图表会在
 *    「出现 → 消失」之间反复。旧图一直留到新的渲染成功，确定失败才撤下。
 * 3. **失败只在生成结束后算数**。流式中的围栏本来就可能是半截语法，此时一律显示渲染中；
 *    等这一轮生成结束（会再渲染一次）仍失败，才显示可读原因并把源码还原成代码块。
 * 4. **主题跟随**。渲染用的主题在渲染那一刻读取，因此明暗模式或主题切换后重新渲染的图表
 *    直接跟随；切换主题时不会为此重建整棵消息树。
 *
 * 图表标识由**源码**派生，不用 `useId`：分段离屏回收会卸载并重建这个组件，而渲染预算与
 * Mermaid 的确定性 id 都需要一个跨重挂载稳定的标识。`useId` 随组件实例变化，用它会让
 * 「滚出去再滚回来」被当成一张新图——预算被白消耗，渲染缓存也用不上。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TbAlertTriangle, TbCheck, TbCopy, TbMaximize } from "react-icons/tb";
import { use_markdown_streaming } from "@/components/markdown/markdown_stream_context";
import { MermaidFullscreen } from "@/components/markdown/mermaid/MermaidFullscreen";
import { hash_mermaid_source, render_mermaid_svg } from "@/components/markdown/mermaid/render_mermaid";
import { use_mermaid_render_budget } from "@/components/markdown/mermaid/mermaid_render_budget";
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
  /**
   * 图表标识：由源码派生，跨组件重挂载稳定。
   *
   * 预算与 Mermaid 的确定性 id 都依赖它；若换成 `useId`，分段回收造成的重挂载会被当成新图。
   */
  const render_key = useMemo(() => hash_mermaid_source(source), [source]);
  const render_budget = use_mermaid_render_budget();
  const container_ref = useRef<HTMLDivElement>(null);
  const [visible, set_visible] = useState(false);
  const [svg, set_svg] = useState("");
  const [failed, set_failed] = useState(false);
  const [attempt, set_attempt] = useState(0);
  const [copied, set_copied] = useState(false);
  const [fullscreen, set_fullscreen] = useState(false);
  /** 本图是否在渲染预算内；超出后只显示占位，等用户显式要求。 */
  const [granted, set_granted] = useState(() => render_budget?.claim(render_key) ?? true);

  /**
   * 内容变化后重新结算预算。
   *
   * 首次挂载的结算必须发生在渲染阶段（见上方 `useState` 初始值），否则首屏就可见的图表会在
   * 同一个 commit 里用未结算的值启动渲染，绕过预算。后续内容变化（流式结束后）再走这里。
   * 流式期间不结算：源码每个 chunk 都在变，逐次结算会把整个会话的额度吃光。
   * 标识由源码派生，因此同一张图重挂载不会重复占用。
   */
  useEffect(() => {
    if (streaming) return;
    set_granted(render_budget?.claim(render_key) ?? true);
  }, [render_key, render_budget, streaming]);

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

  // 重新渲染期间保留上一张图，避免流式生成时每个 chunk 都把图表打回占位再重画。
  // 只有渲染失败才撤下它——那时旧结果已经不属于当前源码，视图退回源码更诚实。
  useEffect(() => {
    if (!visible || !source || !granted) return;

    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        void render_mermaid_svg(source).then(
          (rendered) => {
            if (cancelled) return;
            set_svg(rendered);
            set_failed(false);
          },
          () => {
            if (cancelled) return;
            set_failed(true);
            // 流式期间失败很常见（围栏还没写完），此时保留最后一次成功结果；
            // 否则图表会在“出现 → 消失”之间反复。结束生成后仍失败才撤下它、退回源码。
            if (!streaming) set_svg("");
          },
        );
      },
      streaming ? streaming_render_delay : 0,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [attempt, granted, render_key, source, streaming, theme_revision, visible]);

  const copy_source = useCallback(async () => {
    if (!source) return;
    await navigator.clipboard.writeText(source);
    set_copied(true);
    window.setTimeout(() => set_copied(false), copied_feedback_duration);
  }, [source]);

  if (!source) return null;

  // 预算耗尽且尚无渲染结果时才显示占位。已经渲染出来的图不因为预算变化被撤下：
  // 流式期间不结算预算（见上方注释），若结束后才发现超额就把刚渲染好的图换成占位，
  // 用户会看到图表一闪而过。
  if (!granted && !svg) {
    return (
      <div ref={container_ref} className="markdown-mermaid" data-mermaid-state="limited">
        <div className="markdown-mermaid-fallback">
          <div className="markdown-mermaid-status">
            <span className="markdown-mermaid-status-text">{translate("mermaid.render_limited", { count: render_budget?.limit ?? 0 })}</span>
            <button
              type="button"
              className={`${mermaid_action_button_class_name} markdown-mermaid-retry`}
              onClick={() => {
                // 用户显式要求渲染：无视上限占用预算，并回到待渲染态。
                render_budget?.claim_forced(render_key);
                set_granted(true);
                set_failed(false);
                set_attempt((current) => current + 1);
              }}
            >
              {translate("mermaid.render_limited_action")}
            </button>
          </div>
          <div className="markdown-mermaid-source">{source}</div>
        </div>
      </div>
    );
  }

  // 流式生成中的围栏本来就可能是半截语法，此时不把失败当真：显示渲染中，
  // 等这一轮生成结束（streaming 变假会重跑一次渲染）再决定是呈现图表还是回退到源码。
  const state = svg ? "rendered" : failed && !streaming ? "failed" : "pending";

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

      {fullscreen && svg ? <MermaidFullscreen svg={svg} on_close={() => set_fullscreen(false)} /> : null}
    </div>
  );
}
