/** 用户消息折叠预览协议；字符预算与 Markdown 完整块策略由 SDK 拥有。 */
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
