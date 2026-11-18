/**
 * Chat Composer 围栏代码块的纯语法：输入识别、粘贴识别与 Markdown 序列化。
 *
 * ## 为什么放在 common
 *
 * 序列化规则必须与 `chatComposerProjection` 同源：Main 与 Renderer 两侧都用同一份
 * 规则投影文档，代码块的围栏长度、语言清洗、内容不转义这三件事不能各写一遍。
 * 因此这里只放**不依赖编辑器实例、也不依赖 DOM**的纯函数；
 * 需要 Tiptap 扩展的那一层在 `renderer/.../chatComposerCodeFence`。
 *
 * ## 为什么需要单独识别围栏
 *
 * Composer 的裸 Enter 有一条「单个纯文本段落就发送」的规则（见 `chatComposerKeymap`）。
 * 用户敲 ``` 再回车时，那个段落恰好是一个纯文本段落，于是消息被直接发出去——
 * 发送的是三个反引号本身。Tiptap 自带的围栏 input rule 也救不了这个场景：
 * 它要求围栏后紧跟一个空白字符（``` + 空格），而 ``` + 回车拿不到。
 */

import type { JSONContent } from "@tiptap/core";

/**
 * 一整行围栏标记。
 *
 * 前导最多 3 个空格（与 CommonMark 一致），反引号或波浪号至少 3 个，
 * 之后可选一个语言标记。**整行匹配**：段落里混着别的内容时不算围栏，
 * 否则「请看 ``` 这个符号」会被误判成代码块开头。
 */
export const chat_composer_code_fence_line = /^ {0,3}(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+#.-]*)[ \t]*$/;

/** 语言标记的合法字符集：与围栏语法一致，也是序列化时允许透传的字符。 */
const code_language_pattern = /[^A-Za-z0-9_+#.-]/gu;

/** 光标之前的整块文本恰好是一个围栏起始行时，返回它的语言。 */
export function read_chat_composer_code_fence(text_before_cursor: string): { language: string } | undefined {
  const match = chat_composer_code_fence_line.exec(text_before_cursor);
  if (!match) return undefined;
  return { language: (match[2] ?? "").toLowerCase() };
}

/** 从属性里读出一个可安全写进围栏的语言标记。 */
export function read_chat_composer_code_language(attributes: { language?: unknown } | undefined): string {
  return String(attributes?.language ?? "").trim().toLowerCase().replace(code_language_pattern, "");
}

/**
 * 把一段围栏代码序列化成 Markdown。
 *
 * ## 为什么围栏长度要按内容算
 *
 * 代码本身含 ``` 时，靠转义是救不回来的——Markdown 的代码块没有转义机制，
 * 唯一办法是让外层围栏比内容里最长的那串反引号更长（与 duobox 的
 * `codeBlockSerializeRule` 同一做法）。固定 3 个反引号会在「粘贴一段含围栏的
 * Markdown 示例」时把消息切成两半。
 *
 * 代码体**一个字符都不转义**：这是代码块相对普通段落的关键差别，
 * 也是本次修复的核心——原实现按普通段落转义，把 `*`、`_`、`$` 全写成了反斜杠形式。
 */
export function serialize_chat_composer_code_block(language: string, code: string): string {
  const longest_backtick_run = Math.max(0, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest_backtick_run + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}

/**
 * 识别剪贴板里成对的围栏代码块；无法确定边界时返回 undefined。
 *
 * ## 只认成对围栏，其余一律不猜
 *
 * 粘贴是「贴代码」这条高频路径。若不处理，纯文本会被按换行拆成一堆段落，
 * 围栏字符再被当成普通文本转义，用户拿到的是一团乱码。
 *
 * 但识别必须是**保守**的：只有开栏与闭栏都齐全时才接管，否则交回 ProseMirror 默认行为。
 * 半截围栏无法判断在哪结束，假装切得开只会把用户的内容切错——
 * 与 `user_message_preview.ts` 里 `split_complete_blocks` 的取舍一致。
 *
 * 同样刻意不做粗体、斜体、列表的 Markdown 识别：用户粘贴 `**x**` 时想要的多半是字面量。
 */
export function parse_fenced_paste(text: string): JSONContent[] | undefined {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const nodes: JSONContent[] = [];
  let index = 0;
  let saw_code_block = false;

  while (index < lines.length) {
    const opener = chat_composer_code_fence_line.exec(lines[index] ?? "");
    if (opener) {
      const marker = opener[1]!;
      const language = (opener[2] ?? "").toLowerCase();
      const code: string[] = [];
      let cursor = index + 1;
      let closed = false;
      while (cursor < lines.length) {
        const candidate = chat_composer_code_fence_line.exec(lines[cursor] ?? "");
        // 闭合围栏：同种字符、不短于开栏、且不声明语言（声明了语言的行是新的开栏）。
        if (candidate && candidate[1]![0] === marker[0] && candidate[1]!.length >= marker.length && !candidate[2]) {
          closed = true;
          break;
        }
        code.push(lines[cursor] ?? "");
        cursor += 1;
      }
      if (!closed) return undefined;
      // 空围栏不构成内容；但要记下「确实遇到并处理过围栏」，否则会被当成普通文本。
      if (code.some((line) => line.trim())) {
        nodes.push({ type: "codeBlock", attrs: { language }, content: [{ type: "text", text: code.join("\n") }] });
      }
      saw_code_block = true;
      index = cursor + 1;
      continue;
    }
    // 围栏之外的行按段落，与 ProseMirror 默认的多行纯文本粘贴一致（空行被丢掉）。
    const line = lines[index]!;
    if (line.trim()) nodes.push({ type: "paragraph", content: [{ type: "text", text: line }] });
    index += 1;
  }

  return saw_code_block && nodes.length > 0 ? nodes : undefined;
}
