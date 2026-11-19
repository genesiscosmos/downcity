/**
 * Chat UI 的运行时输入展示协议。
 *
 * input 保持为 Agent Message 内独立的 Part；只携带可展示的内容与来源，
 * 不包含执行记账 meta，也不依赖 Session SDK 或模型投影格式。
 */

/** 运行时输入中允许展示的内容，按来源顺序排列。 */
export type DowncityChatInputContent =
  | {
      /** 普通文本内容。 */
      type: "text";
      /** 原始文本，由 React 按纯文本安全展示。 */
      text: string;
    }
  | {
      /** 带语义标签的运行时上下文。 */
      type: "context";
      /** 上下文的语义标签，仅作为普通文字展示。 */
      tag: string;
      /** 上下文原文，不作为 Agent 回复或 HTML 渲染。 */
      context: string;
    }
  | {
      /** 文件引用；展示本身不自动读取文件或加载媒体。 */
      type: "file";
      /** 文件引用路径或 URL，作为文字提示使用。 */
      url: string;
      /** 文件的 IANA MIME 类型。 */
      media_type: string;
      /** 可选的原始文件名。 */
      filename?: string;
    };

/** 运行时输入的因果来源，仅用于识别关联事件。 */
export interface DowncityChatInputSource {
  /** 产生该输入的工具调用标识。 */
  tool_call_id?: string;
  /** 产生该输入的来源 Turn 标识。 */
  turn_id?: string;
}

/** Agent Message 内独立展示的运行时输入 Part。 */
export interface DowncityChatInputPart {
  /** 当前 Part 的稳定展示标识。 */
  id: string;
  /** Part 判别字段，保持为 input。 */
  type: "input";
  /** 来源事件的稳定幂等标识。 */
  input_id: string;
  /** 运行时输入的语义类别。 */
  kind: string;
  /** 可选的来源工具调用与 Turn 关联。 */
  source?: DowncityChatInputSource;
  /** 原始事件内容，排除执行记账与嵌套 Part。 */
  content: DowncityChatInputContent[];
  /** 输入写入时间戳，单位为毫秒。 */
  created_at?: number;
}
