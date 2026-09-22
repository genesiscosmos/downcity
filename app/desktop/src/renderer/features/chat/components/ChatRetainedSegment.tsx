/**
 * 消息分段的离屏回收容器。
 *
 * 长会话的内存大头不在消息数据，而在已经渲染过的 DOM：每条消息都带完整 Markdown 子树、
 * React Fiber 与高亮 token，而它们一旦挂载就再也不会消失。这里给分段加一层可回收的容器：
 * 分段远离视口后卸载内容、只留一个等高占位，滚回来时再从 canonical 消息重新渲染。
 *
 * 三个决定：
 *
 * 1. **占位用实测高度，不用估算。** `chat.css` 明确禁止给消息行做离屏布局跳过，理由是占位
 *    高度与真实高度相差一个数量级，会让向上浏览时内容反复被推走又弹回。这里取的是卸载前
 *    那一刻的真实高度，替换前后高度相等，浏览器原生滚动锚定因此继续有效——它补偿的是
 *    「视口上方内容变高」，而等高替换不产生这种变化。
 * 2. **只在长会话启用。** 卸载会让离屏内容不再参与浏览器 Ctrl+F 查找与跨分段文本选择，
 *    这是实打实的功能损失。短会话的 DOM 本来就不大，不值得为此付费；
 *    因此由调用方按会话规模决定是否启用。
 * 3. **流式分段永不回收。** 流式消息的高度每帧都在变，占位值立刻过期，回收它只会换来跳动。
 *
 * 宽度变化时立即挂载一次重新测量：换行数随宽度变化，旧的实测高度不再成立。窗口缩放是
 * 低频操作，这一次重排可以接受。
 *
 * 观察器按**滚动容器共享**：长会话会有几十个分段，每个各建两个观察器意味着上百个实例。
 * 共享后每个滚动容器各一个，分段只做注册与注销。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

/** 视口外仍保留挂载的缓冲范围；超出它才允许回收。取一屏，兼顾回收力度与滚动抖动。 */
const retention_root_margin = "100% 0px";

/** 宽度变化超过该值才视为真正的布局变化，避免亚像素抖动触发重排。 */
const width_change_tolerance = 1;

/** 一个分段向共享观察器注册的回调集合。 */
interface SegmentObserverHandlers {
  /** 交叉状态变化；`height` 为离开视口那一刻的真实高度。 */
  on_intersection(is_intersecting: boolean, height: number): void;
  /** 宽度变化，旧高度不再成立。 */
  on_width_change(): void;
}

/** 按滚动容器缓存的共享观察器。 */
interface SharedObservers {
  /** 交叉观察器；负责判断分段是否离开视口。 */
  intersection: IntersectionObserver;
  /** 尺寸观察器；负责发现宽度变化。 */
  resize: ResizeObserver;
  /** 元素到回调的映射，用于把观察结果分发给对应分段。 */
  handlers: Map<Element, SegmentObserverHandlers>;
}

/** 按滚动容器元素缓存的观察器；滚动容器卸载后由最后一个分段清理。 */
const shared_observers = new WeakMap<Element, SharedObservers>();

/** 取用（必要时创建）某个滚动容器对应的共享观察器。 */
function get_shared_observers(root: Element | null): SharedObservers {
  const cache_key = root ?? document.documentElement;
  const existing = shared_observers.get(cache_key);
  if (existing) return existing;

  const handlers = new Map<Element, SegmentObserverHandlers>();
  const created: SharedObservers = {
    handlers,
    intersection: new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const handler = handlers.get(entry.target);
          if (!handler) continue;
          // 回收前记下此刻的真实高度：占位与真实值相等，视口上方内容才不会被推动。
          handler.on_intersection(entry.isIntersecting, entry.boundingClientRect.height);
        }
      },
      { root: root ?? null, rootMargin: retention_root_margin },
    ),
    resize: new ResizeObserver((entries) => {
      for (const entry of entries) handlers.get(entry.target)?.on_width_change();
    }),
  };
  shared_observers.set(cache_key, created);
  return created;
}

/**
 * 分段级离屏回收容器。
 *
 * 只负责「留内容还是留占位」这一个判断，分段内容与消息渲染仍由调用方决定，
 * 因此它不关心 Session、投影或滚动状态。
 */
export function ChatRetainedSegment({ segment_id, enabled, streaming, children }: {
  /** 分段稳定标识；保留在 DOM 上，供滚动恢复与排查定位。 */
  segment_id: number;
  /** 是否允许回收离屏内容；为假时始终保留完整 DOM。 */
  enabled: boolean;
  /** 分段是否包含仍在流式更新的消息；为真时永不回收。 */
  streaming: boolean;
  /** 分段内容。 */
  children: ReactNode;
}) {
  const [retained, set_retained] = useState(true);
  const container_ref = useRef<HTMLDivElement>(null);
  /** 最近一次卸载前记录的真实高度，作为占位高度。 */
  const height_ref = useRef(0);
  /** 最近一次测得的宽度，用于过滤亚像素抖动。 */
  const width_ref = useRef(0);

  useEffect(() => {
    const element = container_ref.current;
    if (!element || !enabled || typeof IntersectionObserver === "undefined") return;
    // root 取外层滚动容器：以 viewport 为基准在聊天面板不满屏时会产生明显偏差。
    const observers = get_shared_observers(element.closest("[data-chat-scroll-viewport]"));
    width_ref.current = element.getBoundingClientRect().width;
    observers.handlers.set(element, {
      on_intersection: (is_intersecting, height) => {
        if (is_intersecting) {
          set_retained(true);
          return;
        }
        height_ref.current = height;
        set_retained(false);
      },
      on_width_change: () => {
        const width = element.getBoundingClientRect().width;
        if (Math.abs(width - width_ref.current) < width_change_tolerance) return;
        width_ref.current = width;
        // 宽度变化后旧高度不再成立，先挂载回真实内容重新测量。
        set_retained(true);
      },
    });
    observers.intersection.observe(element);
    observers.resize.observe(element);
    return () => {
      observers.handlers.delete(element);
      observers.intersection.unobserve(element);
      observers.resize.unobserve(element);
    };
  }, [enabled]);

  if (!enabled || streaming || retained) {
    return <div ref={container_ref} data-chat-segment-id={segment_id}>{children}</div>;
  }
  return <div ref={container_ref} data-chat-segment-id={segment_id} style={{ height: height_ref.current }} />;
}
