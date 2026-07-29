/**
 * Federation CLI Bureau 管理类型。
 *
 * 这些类型只描述 CLI 本地生成的部署凭证和命令输入，不代表 Federation
 * 签发协议。
 */

/** CLI 本地生成的 Bureau 部署凭证。 */
export interface BureauDeploymentCredential {
  /** 用于 Federation 数据库查找注册记录的公开 ID。 */
  token_id: string;

  /** 只显示一次并配置到 Bureau 环境变量的完整明文。 */
  bureau_token: string;

  /** 提交给 Federation 保存的 SHA-256 Base64URL hash。 */
  token_hash: string;
}

/** CLI 完成登记后返回给命令层的一次性 Bureau Token。 */
export interface CreatedFederationBureauToken extends BureauDeploymentCredential {
  /** Token 所登记到的 Federation HTTP 入口。 */
  federation_url: string;

  /** Token 对应的部署位置或业务用途。 */
  purpose: string;
}
