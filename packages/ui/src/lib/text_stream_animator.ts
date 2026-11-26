/**
 * Agent 正文的轻量显示调度器：按积压量追赶，按帧推进，独立限制文本提交频率。
 * 只保存最新原文和数字游标；没有逐字队列、DOM 包装或模型侧等待。
 *
 * Adaptive reveal adapted from assistant-ui's TextStreamAnimator:
 * https://github.com/assistant-ui/assistant-ui/blob/main/packages/react/src/utils/smooth/useSmooth.ts
 *
 * MIT License — Copyright (c) 2026 AgentbaseAI Inc.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/** 每字符最长 5ms；较长积压按 180ms 追赶参数自动提速。 */
const max_character_interval_ms = 5;
const drain_ms = 180;
/** 正常提交最多约 30 次/秒，最终一帧不等待限频。 */
const min_commit_ms = 32;
/** 暂停帧或异常大批次不积累超过此时间的显示债务。 */
const max_backlog_ms = 600;

/** 共享原生分段器，只在真正提交文字时定位当前字素，不创建字符数组。 */
let grapheme_segmenter: Intl.Segmenter | undefined;

/** 一条正在生成或追赶末尾的正文显示游标。 */
export class TextStreamAnimator {
  /** 当前权威原文；仅由宿主更新。 */
  private target_text = "";
  /** 已推进的 UTF-16 位置，提交时对齐完整字素。 */
  private position = 0;
  /** 最后一次实际提交的游标，避免相同前缀重复通知。 */
  private committed_position = 0;
  /** 唯一待执行帧；无积压时为 null。 */
  private frame_id: number | null = null;
  /** 上帧时间与尚不足一个字符的时间余额。 */
  private last_frame_at = 0;
  private carried_ms = 0;
  /** 上次实际通知 React 的时间。 */
  private last_commit_at = -Infinity;
  /** 当前追赶水位及其出现时间；追过该水位后开始下一段，连续输出不会周期性全量刷新。 */
  private backlog_position = 0;
  private backlog_started_at = 0;
  /** 当前原文的惰性字素视图；替换原文即失效。 */
  private segments: Intl.Segments | undefined;
  /** 仅动画运行期间监听系统减少动态效果设置。 */
  private motion_query: MediaQueryList | undefined;

  /** 提交完整可见前缀及其来源，调用方可以复用未变化的渲染。 */
  private readonly commit: (text: string, source_text: string) => void;

  constructor(commit: (text: string, source_text: string) => void, initial_text = "") {
    this.commit = commit;
    this.target_text = initial_text;
    this.position = initial_text.length;
    this.committed_position = initial_text.length;
  }

  /** 更新权威原文；替换、关闭平滑或后台显示时直接对齐。 */
  update(text: string, streaming: boolean, enabled: boolean): void {
    const continuous = text === this.target_text || text.startsWith(this.target_text);
    if (text !== this.target_text) this.segments = undefined;
    this.target_text = text;
    const motion_query = this.motion_query ?? window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!enabled || !continuous || document.visibilityState === "hidden"
      || motion_query.matches
      || (!streaming && this.position === 0)) {
      this.flush();
      return;
    }
    if (this.position >= text.length || this.frame_id !== null) return;
    const now = performance.now();
    this.last_frame_at = now;
    this.backlog_started_at = now;
    this.backlog_position = text.length;
    this.carried_ms = 0;
    this.motion_query = motion_query;
    this.motion_query.addEventListener("change", this.handle_visibility);
    document.addEventListener("visibilitychange", this.handle_visibility);
    this.frame_id = requestAnimationFrame(this.animate);
  }

  /** 停止或导出时直接显示全部原文；没有活动监听器或待执行帧残留。 */
  flush(): void {
    this.cancel();
    this.position = this.target_text.length;
    this.publish(performance.now(), true);
  }

  /** 卸载只释放资源，不再通知已卸载的 React 组件。 */
  cancel(): void {
    if (this.frame_id !== null) cancelAnimationFrame(this.frame_id);
    this.frame_id = null;
    this.motion_query?.removeEventListener("change", this.handle_visibility);
    this.motion_query = undefined;
    document.removeEventListener("visibilitychange", this.handle_visibility);
    this.carried_ms = 0;
    this.last_commit_at = -Infinity;
  }

  /** 切到后台或启用减少动态效果时，不等待被浏览器暂停的动画帧。 */
  private handle_visibility = (): void => {
    if (document.visibilityState === "hidden" || this.motion_query?.matches) this.flush();
  };

  /** 只做常数时间的游标推进；字素定位与字符串切片留到实际提交。 */
  private animate = (now: number): void => {
    this.frame_id = null;
    const remaining = this.target_text.length - this.position;
    const interval_ms = Math.min(max_character_interval_ms, drain_ms / remaining);
    const available_ms = Math.max(0, now - this.last_frame_at) + this.carried_ms;
    const count = Math.min(remaining, Math.floor(available_ms / interval_ms));
    this.position += count;
    this.carried_ms = available_ms - count * interval_ms;
    this.last_frame_at = now;
    if (now - this.backlog_started_at >= max_backlog_ms) this.position = this.target_text.length;
    if (this.position >= this.backlog_position) {
      this.backlog_position = this.target_text.length;
      this.backlog_started_at = now;
    }
    const complete = this.position === this.target_text.length;
    if (complete || now - this.last_commit_at >= min_commit_ms) this.publish(now);
    if (complete) this.cancel();
    else this.frame_id = requestAnimationFrame(this.animate);
  };

  /** 使用原生字素边界，避免拆开 Emoji、组合附加符或 ZWJ 序列。 */
  private publish(now: number, force = false): void {
    if (this.position > 0 && this.position < this.target_text.length) {
      grapheme_segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
      this.segments ??= grapheme_segmenter.segment(this.target_text);
      const segment = this.segments.containing(this.position - 1);
      if (segment) this.position = segment.index + segment.segment.length;
    }
    if (!force && this.position === this.committed_position) return;
    this.committed_position = this.position;
    this.last_commit_at = now;
    this.commit(this.target_text.slice(0, this.position), this.target_text);
  }
}
