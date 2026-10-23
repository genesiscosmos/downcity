/**
 * MCP Renderer 的配置管理协议与本地编辑状态。
 * 原始 TOML 仅由 Config 管理通道读取，不进入业务状态视图。
 */

import type { McpServerFile } from "./McpServerFiles.js";

/** Config 中单个文件的编辑草稿。 */
export interface McpConfigFileDraft extends McpServerFile {
  /** 编辑器内稳定身份，修改新文件 ID 时仍保持输入焦点。 */
  draft_key: string;
  /** 载入时的完整原文；保存和删除时用于检测外部修改。 */
  original_content: string;
  /** 是否为尚未创建文件的新草稿，保存时必须传 create:true。 */
  create: boolean;
  /** 当前文件最近一次管理操作失败的消息。 */
  operation_error?: string;
}

/** Config 测试动作返回的工具摘要。 */
export interface McpConfigTestView {
  /** 现有文件连接成功后可见的工具数量。 */
  tool_count: number;
}

/** 配置编辑器的单一状态，保证快照与草稿原子更新。 */
export interface McpConfigEditorState {
  /** 最近成功读取的实际配置目录。 */
  directory: string;
  /** 各文件的原文基线和未保存内容。 */
  drafts: McpConfigFileDraft[];
}
