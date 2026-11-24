/** 非 Power 活动的只读详情协议；适配器负责语义，组件只负责有界渲染。 */

/** 由本地翻译或可靠原文构成的一小段文案。 */
export interface ActivityText {
  /** 本地化键；不存在时使用原文。 */ key?: string;
  /** 本地化参数，数字也使用字符串。 */ values?: Record<string, string>;
  /** 工具已经返回的正文，不推断或改写其含义。 */ text?: string;
}

/** 一条只读问答，不包含私密值或可提交控件。 */
export interface ActivityQuestion {
  /** 用户可读问题原文。 */ question: string;
  /** 已脱敏并按选项标签转换的回答或当前状态。 */ answer: ActivityText;
}

/** 可读正文；列表和文本在适配器及视图两端均有显示上限。 */
export type ActivityReadableBody =
  | { /** 普通文件或动作正文。 */ type: "text"; /** 原文。 */ text: string }
  | { /** 只读问答。 */ type: "questions"; /** 请求顺序的问题及响应。 */ questions: ActivityQuestion[] };

/** 文件、搜索、提问及 Session Action 共用的克制详情外壳。 */
export interface ActivityReadableDetail {
  /** 归一化详情判别符。 */ type: "readable";
  /** 仅用于正文格式识别的目标路径，不作为重复标题显示。 */ target: string;
  /** 错误、空内容或预览省略等影响正文理解的必要提示。 */ facts: ActivityText[];
  /** 存在可靠正文时才提供。 */ body?: ActivityReadableBody;
}
