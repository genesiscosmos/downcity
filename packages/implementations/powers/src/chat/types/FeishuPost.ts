/**
 * Feishu `post` 富文本消息类型定义。
 *
 * 关键点（中文）
 * - 统一描述飞书 `msg_type=post` 的核心结构，供入站解析与出站构建复用。
 * - 这里只保留当前 chat platform 真正会消费的字段，避免把平台超大 schema 整体引入运行时。
 */

/**
 * Feishu `post` 语言块 key。
 *
 * 说明（中文）
 * - 飞书常见语言块为 `zh_cn` / `en_us` / `ja_jp`。
 * - 为了兼容未来新增 locale，这里保留 `string` 兜底。
 */
export type FeishuPostLocaleKey =
  | "zh_cn"
  | "en_us"
  | "ja_jp"
  | "zh_hk"
  | "zh_tw"
  | string;

/**
 * Feishu `post` 顶层 payload。
 */
export interface FeishuPostPayload {
  /**
   * 语言块映射。
   *
   * 说明（中文）
   * - key 为 locale。
   * - value 为该语言对应的标题与内容。
   */
  [locale: string]: FeishuPostLocaleContent | unknown;
}

/**
 * 单个 locale 下的富文本内容。
 */
export interface FeishuPostLocaleContent {
  /**
   * 富文本标题。
   *
   * 说明（中文）
   * - 可为空字符串。
   * - 入站解析时会作为正文前缀保留。
   */
  title?: string;

  /**
   * 富文本正文二维数组。
   *
   * 说明（中文）
   * - 第一维表示“段/行”。
   * - 第二维表示这一行中的富文本节点序列。
   */
  content?: FeishuPostParagraph[];
}

/**
 * 一行富文本节点列表。
 */
export type FeishuPostParagraph = FeishuPostElement[];

/**
 * Feishu `post` 支持的节点联合。
 *
 * 说明（中文）
 * - 当前覆盖文本、链接、提及、图片、媒体、表情、分割线等常见节点。
 * - 未识别节点会在运行时按兜底策略处理，不依赖这里声明全部平台字段。
 */
export type FeishuPostElement =
  | FeishuPostTextElement
  | FeishuPostLinkElement
  | FeishuPostMentionElement
  | FeishuPostImageElement
  | FeishuPostMediaElement
  | FeishuPostEmotionElement
  | FeishuPostHrElement
  | FeishuPostUnknownElement;

/**
 * 文本节点。
 */
export interface FeishuPostTextElement {
  /**
   * 节点类型。
   */
  tag: "text";

  /**
   * 文本内容。
   *
   * 说明（中文）
   * - 出站时直接显示给用户。
   * - 入站时会被拼接回自然语言正文。
   */
  text: string;

  /**
   * 是否对特殊字符做转义控制。
   *
   * 说明（中文）
   * - 飞书 `post` 会携带该字段。
   * - 当前 runtime 不依赖该值做逻辑判断，仅做结构兼容保留。
   */
  un_escape?: boolean;

  /**
   * 文本样式集合。
   *
   * 说明（中文）
   * - 如 `bold` / `underline` / `lineThrough` / `italic`。
   * - 当前仅透传兼容，不参与 runtime 主逻辑。
   */
  style?: string[];
}

/**
 * 超链接节点。
 */
export interface FeishuPostLinkElement {
  /**
   * 节点类型。
   */
  tag: "a";

  /**
   * 链接展示文本。
   */
  text: string;

  /**
   * 链接目标地址。
   */
  href: string;

  /**
   * 可选文本样式集合。
   */
  style?: string[];
}

/**
 * @提及节点。
 */
export interface FeishuPostMentionElement {
  /**
   * 节点类型。
   */
  tag: "at";

  /**
   * 被提及用户 ID。
   *
   * 说明（中文）
   * - 可能是 `open_id` / `user_id`。
   * - `all` 场景通常不依赖该字段。
   */
  user_id?: string;

  /**
   * 被提及用户展示名。
   *
   * 说明（中文）
   * - 入站解析时优先使用该字段生成 `@用户名`。
   */
  user_name?: string;
}

/**
 * 图片节点。
 */
export interface FeishuPostImageElement {
  /**
   * 节点类型。
   */
  tag: "img";

  /**
   * 飞书图片资源 key。
   *
   * 说明（中文）
   * - 入站时用于下载消息内图片。
   * - 出站时由图片上传接口返回。
   */
  image_key: string;

  /**
   * 可选替代文本。
   *
   * 说明（中文）
   * - 平台不会总是返回该字段。
   * - 当前主要用于生成更友好的文本占位与附件描述。
   */
  alt?: string;
}

/**
 * 媒体节点。
 */
export interface FeishuPostMediaElement {
  /**
   * 节点类型。
   *
   * 说明（中文）
   * - 部分 payload 可能使用 `media` / `file` / `audio` / `video`。
   */
  tag: "media" | "file" | "audio" | "video";

  /**
   * 飞书文件资源 key。
   *
   * 说明（中文）
   * - 当前主要用于下载视频/文件/音频资源。
   */
  file_key?: string;

  /**
   * 可选预览图 key。
   */
  image_key?: string;

  /**
   * 可选文件名。
   */
  file_name?: string;

  /**
   * 可选标题。
   */
  title?: string;

  /**
   * 可选时长（秒）。
   */
  duration?: number;
}

/**
 * 表情节点。
 */
export interface FeishuPostEmotionElement {
  /**
   * 节点类型。
   */
  tag: "emotion";

  /**
   * 表情类型标识。
   *
   * 说明（中文）
   * - 当前入站会退化成可读文本占位，例如 `[表情:smile]`。
   */
  emoji_type?: string;
}

/**
 * 分割线节点。
 */
export interface FeishuPostHrElement {
  /**
   * 节点类型。
   */
  tag: "hr";
}

/**
 * 未知节点兜底结构。
 */
export interface FeishuPostUnknownElement {
  /**
   * 节点类型原文。
   *
   * 说明（中文）
   * - 当平台新增新节点时，运行时仍可通过该字段做兜底处理。
   */
  tag: string;

  /**
   * 节点原始文本。
   *
   * 说明（中文）
   * - 并非所有未知节点都有该字段。
   * - 当前仅在兜底拼接正文时 best-effort 使用。
   */
  text?: string;

  /**
   * 节点原始标题。
   */
  title?: string;

  /**
   * 节点原始链接。
   */
  href?: string;

  /**
   * 节点原始图片 key。
   */
  image_key?: string;

  /**
   * 节点原始文件 key。
   */
  file_key?: string;

  /**
   * 其他平台字段。
   *
   * 说明（中文）
   * - 保留开放形态，避免 schema 漂移导致类型过度僵化。
   */
  [key: string]: unknown;
}

/**
 * 出站 `post` 内联图片描述。
 */
export interface FeishuPostInlineImage {
  /**
   * 飞书图片 key。
   *
   * 说明（中文）
   * - 由 `im/v1/images` 上传接口返回。
   */
  imageKey: string;

  /**
   * 可选图片说明。
   *
   * 说明（中文）
   * - 当前会在图片下一行追加为普通文本。
   */
  caption?: string;
}
