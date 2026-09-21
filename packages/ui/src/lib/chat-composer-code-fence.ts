/**
 * Chat Composer 围栏代码块的纯语法：输入识别、粘贴识别与 Markdown 序列化。
 *
 * ## 为什么需要单独识别围栏
 *
 * Composer 的裸 Enter 有一条「单个纯文本段落就发送」的规则（见 `chat-composer-keymap`）。
 * 用户敲 ``` 再回车时，那个段落恰好是一个纯文本段落，于是消息被直接发出去——
 * 发送的是三个反引号本身。Tiptap 自带的围栏 input rule 也救不了这个场景：
 * 它要求围栏后紧跟一个空白字符（``` + 空格），而 ``` + 回车拿不到。
 *
 * 因此围栏识别必须发生在 Enter 的判定里：本模块提供纯函数读法，
 * `resolve_chat_composer_enter_action` 决定动作，`ChatComposer` 执行
 * 「删掉围栏行 → 转成代码块」。
 *
 * ## 与 Desktop 的关系
 *
 * 这份实现与 `app/desktop/src/common/chat/chatComposerCodeFence.ts` 同源。
 * 两处必须一起改：Desktop 的序列化在 common 里（Main 侧也要用），
 * 而 UI SDK 是独立发包，不能反向依赖 app 的目录。
 */

import type { JSONContent } from "@tiptap/core";
import { Extension } from "@tiptap/core";

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
 * 唯一办法是让外层围栏比内容里最长的那串反引号更长。固定 3 个反引号会在
 * 「粘贴一段含围栏的 Markdown 示例」时把消息切成两半。
 *
 * 代码体**一个字符都不转义**：这是代码块相对普通段落的关键差别。
 */
export function serialize_chat_composer_code_block(language: string, code: string): string {
  const longest_backtick_run = Math.max(0, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest_backtick_run + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}

/**
 * 识别剪贴板里成对的围栏代码块；无法确定边界时返回 undefined。
 *
 * 只有开栏与闭栏都齐全时才接管，否则交回 ProseMirror 默认行为：
 * 半截围栏无法判断在哪结束，假装切得开只会把用户的内容切错。
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

/**
 * 把整份编辑文档投影成可提交的纯文本，围栏代码块保留围栏。
 *
 * ## 为什么不能用 `editor.getText()`
 *
 * `getText()` 只取文本内容，会丢掉代码块的围栏与语言。代码块一旦开用，
 * 那意味着「输入框里明明是一个代码块，发出去变成一段普通文字」——
 * 接收端再也分不出哪部分是代码。
 *
 * 本包没有 Desktop 那样的结构化 parts 投影（那是 Desktop 的 Session 协议），
 * 提交面就是一段纯文本，因此这里只保证一件事：代码块以围栏形式送达。
 * 其余节点按 `getText()` 的口径取文本，不额外引入 Markdown 语义。
 */
export function chat_composer_document_to_text(document: JSONContent | undefined): string {
  if (!document) return "";
  return (document.content ?? [])
    .map((node) => (node.type === "codeBlock" ? code_block_to_text(node) : node_text(node)))
    .filter((part) => part !== "")
    .join("\n\n");
}

/** 一个代码块节点转成围栏文本；空围栏不构成内容。 */
function code_block_to_text(node: JSONContent): string {
  const code = (node.content ?? []).map((child) => String(child.text ?? "")).join("");
  if (!code.trim()) return "";
  return serialize_chat_composer_code_block(read_chat_composer_code_language(node.attrs), code);
}

/** 递归取一个非代码节点的文本。 */
function node_text(node: JSONContent): string {
  if (node.type === "text") return String(node.text ?? "");
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(node_text).join("");
}

/**
 * 把 `codeBlock.language` 写回 DOM，供输入框里的语言标签使用。
 *
 * 围栏语言进入 Tiptap 后只是节点属性。若不写回 DOM，用户敲的 `ts` 会在输入框里
 * 凭空消失——他们会以为语言没生效，然后重复输入。
 *
 * 用全局属性而不是 `CodeBlock.extend()`：`@tiptap/extension-code-block` 是
 * starter-kit 的传递依赖，严格链接下不一定能直接 import。全局属性在 schema 构建时
 * 与节点自带的同名属性合并，实测两者共存：
 * `<pre data-code-language="ts"><code class="language-ts">`。
 *
 * 空语言不写属性，因此无语言的围栏不会留下一个空标签。
 */
export const ChatComposerCodeLanguage = Extension.create({
  name: "chatComposerCodeLanguage",
  addGlobalAttributes() {
    return [{
      types: ["codeBlock"],
      attributes: {
        language: {
          default: "",
          parseHTML: (element: HTMLElement) => element.getAttribute("data-code-language") ?? "",
          renderHTML: (attributes: Record<string, unknown>) =>
            attributes.language ? { "data-code-language": String(attributes.language) } : {},
        },
      },
    }];
  },
});
