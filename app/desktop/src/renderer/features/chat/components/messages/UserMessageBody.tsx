/**
 * 用户气泡正文的折叠容器：内容过长时收起为字符预览，并给出常显的展开开关。
 *
 * ## 判断与截断都在 `lib/user_message_preview.ts`
 *
 * 这里是纯展示：拿到已经算好的预览就渲染它，没有 ref、没有测量、没有 observer。
 * 算法（预算、切块、何时退化）全部在那个纯模块里，可在 `node --test` 里直接验证。
 *
 * ## 折叠态是摘要，展开态是原文
 *
 * 折叠时只渲染文本预览；附件、引用 chip 属于完整内容，展开后可见。
 * 这是「摘要」这个形式的固有含义——预览只取开头，而 chip 不参与字符预算
 *（它们很短，且不属于「阅读长度」）。
 *
 * ## 开关放在气泡内、内容之后
 *
 * 常显（不能靠 hover，否则收起后看不出还有内容）、普通流（不做浮层——
 * 代码块那次的教训是浮层会被滚动内容穿过、且必然压住首行或末行文字）。
 */

import { useState, type ReactNode } from "react";
import { TbChevronDown, TbChevronUp } from "react-icons/tb";
import { Markdown } from "@/components/markdown/Markdown";
import { user_message_collapse_button_class_name, user_message_text_class_name } from "@/features/chat/components/messages/message_layout";
import type { UserMessagePreview } from "@/features/chat/lib/user_message_preview";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";

/** 组装用户气泡的正文，并在内容过长时提供折叠。 */
export function UserMessageBody({ preview, children }: {
  /** 折叠预览；为 null 表示不需要折叠，始终渲染完整内容。 */
  preview: UserMessagePreview | null;
  /** 展开态的完整内容（正文部件、附件、引用）。 */
  children: ReactNode;
}) {
  const translate_chat = use_translation("chat");
  /*
   * 存的是「是否手动展开」而不是「是否折叠」：
   * 这样默认状态就是折叠（长消息一进来就收起），而 preview 变成 null（内容变短）时
   * 会自然退回渲染完整内容，不需要额外的同步 effect。
   */
  const [expanded, set_expanded] = useState(false);

  if (!preview) return children;
  const collapsed = !expanded;

  return <>
    {collapsed
      // plain 表示预览是从超预算的单块里硬切的，按 Markdown 渲染有破坏语法的风险。
      ? preview.plain
        ? <div className={cn("whitespace-pre-wrap break-words", user_message_text_class_name)}>{preview.text}</div>
        : <div className={user_message_text_class_name}><Markdown text={preview.text} mode="static" /></div>
      : children}
    <button
      type="button"
      // 展开态渲染的是另一份内容，不是同一份的显隐，因此不声明 aria-controls。
      aria-expanded={expanded}
      onClick={() => set_expanded((current) => !current)}
      className={user_message_collapse_button_class_name}
    >
      {collapsed ? translate_chat("message.expand") : translate_chat("message.collapse")}
      {collapsed ? <TbChevronDown aria-hidden="true" /> : <TbChevronUp aria-hidden="true" />}
    </button>
  </>;
}
