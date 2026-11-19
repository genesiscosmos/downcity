/** CLI 远程命令参数；复用既有 Token 名称、范围、有效期选项。 */
import type { CityTokenCommandOptions } from "./auth/CityTokenCommand.js";

/** 命令行边界映射后的远程参数；Commander 的 camelCase 留在读取边界。 */
export interface RemoteCommandOptions extends CityTokenCommandOptions {
  /** 本次配置或签发使用的显式客户端基础 URL。 */
  public_url?: string;
  /** 逗号分隔的精确 HTTP/HTTPS 浏览器 Origins。 */
  allowed_origins?: string;
  /** 显式移除保存的公开地址。 */
  clear_public_url?: boolean;
  /** 显式清空额外跨域来源。 */
  clear_allowed_origins?: boolean;
}
