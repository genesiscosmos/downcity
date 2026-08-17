/** Chat Composer 编辑文档、节点属性与 Slash 命令的 Renderer 类型。 */

import type { DesktopChatFileInput, DesktopChatReferenceInput } from "@common/types/DesktopApi";

/** 编辑器内一个附件原子节点的属性。 */
export interface ChatAttachmentNodeAttributes extends DesktopChatFileInput {
  /** 节点在一份草稿中的稳定标识。 */
  attachment_id: string;
}

/** 编辑器内一个引用原子节点的属性。 */
export interface ChatReferenceNodeAttributes extends DesktopChatReferenceInput {
  /** 引用胶囊展示的简短文本。 */
  preview_text: string;
}

/** 可由 Slash 菜单执行的一条命令。 */
export interface ChatSlashCommand {
  /** 命令在当前菜单中的稳定标识。 */
  command_id: string;
  /** 菜单主标题。 */
  title: string;
  /** 帮助用户判断用途的简短说明。 */
  description: string;
  /** 用于匹配 Slash 查询的额外关键词。 */
  keywords: string[];
  /** 删除 Slash 查询后执行命令。 */
  run(): void | Promise<void>;
}
