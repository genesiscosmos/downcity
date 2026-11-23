/** Downtown 命令参数只暴露地址与展示选项，内部身份由宿主派生。 */
/** 命令通用输出和数据根选择。 */
export interface DowntownOptions {
  /** 显式本地数据根；省略时使用 City 默认根。 */
  root?: string;
  /** 输出结构化 JSON，默认用可读 JSON 展示目录来源。 */
  json?: boolean;
  /** 添加连接时的展示名称。 */
  name?: string;
  /** 包含保留历史的已移除连接。 */
  all?: boolean;
  /** 聚合目录的 Downtown 地址筛选。 */
  downtown?: string;
}


/** 服务操作使用用户提供的 Downtown 地址，不接收内部 ID。 */
export interface ServiceOptions {
  /** 每项服务操作必须显式选择的 Town 连接。 */
  downtown: string;
  /** 本地数据根，整个响应期间保持不变。 */
  root?: string;
  /** 发现结果输出完整 JSON；call 正文始终原样输出。 */
  json?: boolean;
  /** 输入文本文件，- 表示标准输入；按目标 Action 声明解释 JSON 或 raw。 */
  input?: string;
  /** 输出文件；省略时写 stdout，支持二进制。 */
  output?: string;
  /** 识别后明确拒绝，绝不把用户令牌当作管理员凭据。 */
  admin?: boolean;
}
