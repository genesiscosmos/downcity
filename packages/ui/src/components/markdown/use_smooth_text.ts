/**
 * 将正文的权威内容映射为有限频率的可见前缀。
 * 动画局限于正文组件；输入、消息状态、复制和导出继续读取原始内容。
 */
import { useLayoutEffect, useRef, useState } from "react";
import { TextStreamAnimator } from "../../lib/text_stream_animator";

/** React 当前已经显示的前缀及对应权威原文。 */
type TextSnapshot = {
  /** 已提交给 Markdown 的完整可见前缀。 */
  text: string;
  /** 本次提交依据的原文，用于同步识别回滚和完整替换。 */
  source_text: string;
};

/** 只有首次生成时才创建调度器；历史保留轻量引用，恢复续写不重播已显示前缀。 */
export function use_smooth_text(text: string, streaming: boolean, enabled: boolean): { /** 当前可见正文。 */ text: string; /** 生成或尾部追赶期间保持流式 Markdown。 */ streaming: boolean } {
  const initial_text_ref = useRef(streaming && enabled ? "" : text);
  const animator_ref = useRef<TextStreamAnimator | null>(null);
  const [snapshot, set_snapshot] = useState<TextSnapshot>(() => ({ text: initial_text_ref.current, source_text: text }));

  useLayoutEffect(() => {
    if (!animator_ref.current && (!enabled || !streaming)) {
      initial_text_ref.current = text;
      return;
    }
    if (!animator_ref.current) {
      const initial_text = text.startsWith(initial_text_ref.current) ? initial_text_ref.current : text;
      animator_ref.current = new TextStreamAnimator((visible_text, source_text) => {
        set_snapshot(current => current.text === visible_text && current.source_text === source_text
          ? current : { text: visible_text, source_text });
      }, initial_text);
      set_snapshot({ text: initial_text, source_text: text });
    }
    animator_ref.current.update(text, streaming, enabled);
  }, [text, streaming, enabled]);
  useLayoutEffect(() => () => animator_ref.current?.cancel(), []);

  // 权威内容非追加变化时，本次绘制即使用新内容，不能先显示上一条草稿再由 effect 修正。
  const continuous = text === snapshot.source_text || text.startsWith(snapshot.source_text);
  const visible_text = !enabled ? text : animator_ref.current
    ? continuous ? snapshot.text : text
    : streaming && text.startsWith(initial_text_ref.current) ? initial_text_ref.current : text;
  return { text: visible_text, streaming: streaming || (enabled && visible_text.length < text.length) };
}
