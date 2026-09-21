/**
 * Chat Composer 围栏代码块的编辑器侧接线。
 *
 * ## 为什么语言标签必须可见
 *
 * 围栏语言进入 Tiptap 后只是 `codeBlock.language` 属性。若不把它写回 DOM，
 * 用户敲的 `ts` 会在输入框里凭空消失——他们会以为语言没生效，然后重复输入。
 * 标签由下面的全局属性写到 `<pre data-code-language>` 上，样式负责呈现。
 *
 * ## 为什么用全局属性而不是 `CodeBlock.extend()`
 *
 * `@tiptap/extension-code-block` 是 starter-kit 的传递依赖，pnpm 的严格链接下
 * 从 app 里 import 不到它。全局属性在 schema 构建时与节点自带的同名属性合并，
 * 实测两者共存：`<pre data-code-language="ts"><code class="language-ts">`。
 *
 * 纯语法（围栏识别、序列化、粘贴识别）在 `@common/chat/chatComposerCodeFence`：
 * 那些规则必须与 `chatComposerProjection` 同源，且 Main 侧也要用。
 */

import { Extension } from "@tiptap/core";

export {
  chat_composer_code_fence_line,
  parse_fenced_paste,
  read_chat_composer_code_fence,
  read_chat_composer_code_language,
  serialize_chat_composer_code_block,
} from "../../../../../common/chat/chatComposerCodeFence.ts";

/**
 * 把 `codeBlock.language` 写回 DOM，供输入框里的语言标签使用。
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
