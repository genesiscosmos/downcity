/** 扩展 CLI 参数，仅在 Commander 适配边界使用其命名规则。 */
export interface ExtensionCommandOptions {
  /** 显式数据根。 */
  root?: string;
  /** 输出唯一 JSON 对象。 */
  json?: boolean;
  /** Git ref。 */
  ref?: string;
  /** 普通配置 JSON 文件，内容不回显。 */
  configurationFile?: string;
  /** 通过标准输入提交秘密 JSON，不回显且不出现在命令行参数。 */
  secretsStdin?: boolean;
  /** 客户端幂等操作 ID。 */
  operationId?: string;
}
