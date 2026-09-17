/**
 * 用户气泡折叠预览的纯逻辑。
 *
 * ## 为什么按字符数，不按行数
 *
 * 曾经的实现是「渲染后用 Range 数行盒」。它依赖布局：要在 paint 前量一次、
 * 再用 ResizeObserver 跟着宽度变化重量，而且正文里混着代码块（行高不同）与
 * 段落外边距时，「行」的定义本身就不唯一。实测结果是折叠不生效。
 *
 * 字符数是内容自身的属性：不依赖布局、不需要 observer、首帧就对，
 * 而且可以在 `node --test` 里直接验证。代价是「前 200 字」不等于固定的行数
 * （中文约 4 行、英文约 2 行）——这是明知的取舍。
 *
 * ## 截断必须取完整块
 *
 * 直接 `slice(0, 200)` 会切在 Markdown 语法中间：切进 `**加粗` 会渲染出字面星号，
 * 切开 ```` ``` ```` 围栏会让后半屏都被当成代码。所以按**块**取：
 *
 * 1. 在空行处切块——但不切在代码围栏内部（围栏里允许空行，按空行切会把围栏切两半）；
 * 2. 从头累加整块，直到接近或达到预算；
 * 3. 每个发出的块都是语法完整的，因此可以安全地按 Markdown 渲染。
 *
 * 唯一的例外是**第一个块本身就超预算**（一个长段落、或一整段长代码）：
 * 此时没有任何完整块可用，退化为按字符截断，并标成 `plain` ——
 * 调用方必须按纯文本渲染它，不能再走 Markdown。
 */

import type { SessionUserMessagePart } from "@downcity/agent";

/** 折叠态显示的字符预算。 */
export const user_message_preview_chars = 200;

/**
 * 超过这个字符数才值得折叠。
 *
 * 必须明显大于 `user_message_preview_chars`，否则「201 字折成 200 字」——
 * 除了多一次点击，什么也没省下。两者保持 2:1。
 */
export const user_message_collapse_over_chars = 400;

/** 折叠预览。 */
export interface UserMessagePreview {
  /** 折叠态要显示的文本。`plain` 为真时是切过的纯文本，否则是完整的 Markdown 块。 */
  text: string;
  /**
   * 是否可以按 Markdown 渲染。
   *
   * 第一个块本身超预算时为真：此时 `text` 是硬切出来的，按 Markdown 渲染有
   * 破坏语法的风险（未闭合的强调、围栏），必须走纯文本。
   */
  plain: boolean;
}

/** 代码围栏的起始标记：行首（允许缩进）的三反引号或三波浪号。 */
const fence_marker = /^\s*(`{3,}|~{3,})/;

/**
 * 按空行把文本切成语法完整的块，且不切在代码围栏内部。
 *
 * 未闭合的围栏会让其后所有内容归入同一块——这是有意的：无法判断围栏在哪结束，
 * 就不该假装切得开。
 */
export function split_complete_blocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  /** 当前打开的围栏标记（保留字符与长度，用于匹配等长或更长的闭合）。 */
  let open_fence: string | null = null;

  const flush = () => {
    if (current.length > 0) blocks.push(current.join("\n"));
    current = [];
  };

  for (const line of text.split("\n")) {
    const marker = fence_marker.exec(line)?.[1];
    if (marker) {
      if (open_fence === null) open_fence = marker;
      else if (marker[0] === open_fence[0] && marker.length >= open_fence.length) open_fence = null;
    }
    // 空行是块边界，但围栏内部的空行不是。
    if (open_fence === null && line.trim() === "") {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

/** 从消息的部件里取出用于计数的纯文本；附件与引用 chip 不计入。 */
export function user_message_parts_text(parts: SessionUserMessagePart[]): string {
  return parts
    .filter((part): part is Extract<SessionUserMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}

/** 尽量收在行边界，避免从一行中间断掉。 */
function clip_at_line_break(text: string, limit: number): string {
  const head = text.slice(0, limit);
  const last_break = head.lastIndexOf("\n");
  return (last_break >= limit * 0.6 ? head.slice(0, last_break) : head).trimEnd();
}

/**
 * 构造折叠预览；内容不够长时返回 null，调用方直接渲染完整内容。
 *
 * 返回值里的 `text` 已经带上结尾的省略号，调用方不需要自己拼。
 */
export function build_user_message_preview(text: string): UserMessagePreview | null {
  if (text.length <= user_message_collapse_over_chars) return null;

  const blocks = split_complete_blocks(text);
  const taken: string[] = [];
  let used = 0;
  for (const block of blocks) {
    // 块之间要补回被吃掉的那个空行，否则预算会略微高估。
    const cost = taken.length === 0 ? block.length : block.length + 2;
    if (taken.length > 0 && used + cost > user_message_preview_chars) break;
    taken.push(block);
    used += cost;
    if (used >= user_message_preview_chars) break;
  }

  const first = taken[0]!;
  // 第一个整块就超预算：没有可用的完整块，退化为纯文本截断。
  if (taken.length === 1 && first.length > user_message_preview_chars) {
    return { text: `${clip_at_line_break(first, user_message_preview_chars)} …`, plain: true };
  }
  return { text: `${taken.join("\n\n")}\n\n…`, plain: false };
}
