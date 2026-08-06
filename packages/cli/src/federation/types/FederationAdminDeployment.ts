/**
 * Federation 管理员部署凭证与数据库写入结果类型。
 *
 * 明文密码只存在于单次 CLI 进程内；数据库与远程命令只接收编码后的密码摘要。
 */

/** 管理员数据库操作模式。 */
export type FederationAdminDatabaseMode = "initialize" | "reset";

/** 单次部署生成的管理员候选凭证。 */
export interface FederationAdminDeploymentCredentials {
  /** 首次创建管理员或显式恢复管理员。 */
  mode: FederationAdminDatabaseMode;
  /** 本次数据库操作的唯一 ID，用于审计与识别实际应用结果。 */
  provision_id: string;
  /** 候选管理员登录 ID。 */
  admin_id: string;
  /** 写入数据库的 PBKDF2 编码摘要。 */
  password_hash: string;
  /** 仅在 CLI 内存中保留并在验证成功后显示一次的明文密码。 */
  password: string;
}

/** 管理员数据库初始化或重置结果。 */
export interface FederationAdminDatabaseResult {
  /** 数据库当前实际生效的管理员 ID。 */
  admin_id: string;
  /** 本次候选凭证是否实际写入数据库。 */
  credentials_applied: boolean;
}
