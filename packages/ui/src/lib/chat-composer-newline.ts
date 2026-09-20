/**
 * Chat Composer 的 Shift + Enter 换行语义。
 *
 * ## 为什么需要单独一个扩展
 *
 * StarterKit 的 `HardBreak` 把 `Shift-Enter` 绑定到 `setHardBreak`，那会在**当前段落内部**
 * 插入一个 `hardBreak` 节点。Composer 的段落之间用空行分隔，而段内换行只产生一个软换行，
 * 发送后正文的块结构也和用户预期不一致：用户按 Shift + Enter 想要的是「正常换行」，
 * 也就是和回车一致的**新段落**。
 *
 * 这里用更高优先级重新绑定 `Shift-Enter`。Tiptap 的插件顺序是「按 priority 降序、同优先级
 * 保持注册顺序」，而 `HardBreak` 的 priority 是默认值 100；本扩展取 1000，因此它的
 * `Shift-Enter` 会先于 `HardBreak` 命中，`HardBreak` 的同名绑定不再有机会执行。
 */

import { Extension, type CommandProps } from "@tiptap/core";

/** 一次换行需要的命令子集，便于把命令链与编辑器实例解耦以便测试。 */
export interface DowncityChatComposerNewlineCommands {
  /** 切分列表项；与回车在列表内的行为一致。 */
  splitListItem(name: string): boolean;
  /** 代码块内插入换行。 */
  newlineInCode(): boolean;
  /** 在附近创建段落。 */
  createParagraphNear(): boolean;
  /** 提升空块。 */
  liftEmptyBlock(): boolean;
  /** 切分当前块。 */
  splitBlock(): boolean;
}

/**
 * Shift + Enter 的换行命令链，顺序与 ProseMirror 原生回车的降级顺序一致。
 *
 * 列表项必须排在最前：列表内回车是「切分列表项」，若先走 `splitBlock`，会在列表项**内部**
 * 再切出一个段落，与回车行为分叉。
 */
export function build_chat_composer_newline_commands({ commands }: CommandProps) {
  return [
    () => commands.splitListItem("listItem"),
    () => commands.newlineInCode(),
    () => commands.createParagraphNear(),
    () => commands.liftEmptyBlock(),
    () => commands.splitBlock(),
  ];
}

/** 让 Shift + Enter 产生新段落而不是段内硬换行。 */
export const ChatComposerNewline = Extension.create({
  name: "chatComposerNewline",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      "Shift-Enter": () => {
        this.editor.commands.first(build_chat_composer_newline_commands);
        // 始终消费按键：若回退给 HardBreak，又会变回段内换行，这正是要修掉的行为。
        return true;
      },
    };
  },
});
