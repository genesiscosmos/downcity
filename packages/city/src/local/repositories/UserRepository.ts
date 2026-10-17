/**
 * 本地单用户信息中心。一个平台数据根只有一个本地使用者，独立于 Federation
 * 账号与外部聊天身份；这里只管理身份和基础资料，不读写 Memory 正文。
 */
import path from "node:path";
import fs from "fs-extra";
import { randomUUID } from "node:crypto";
import { resolve_local_root_path } from "../runtime/LocalPaths.js";

/** 单用户稳定标识，不随登录、退出或切换服务账号变化。 */
export const LOCAL_USER_ID = "local";

/** 本地用户基础资料协议，长期偏好由 MemoryPower 管理。 */
export interface LocalUser {
  /** 本地单用户标识。 */
  user_id: typeof LOCAL_USER_ID;
  /** 可编辑显示名称，不用于鉴权或目录定位。 */
  display_name: string;
  /** 首次创建时间，ISO 8601。 */
  created_at: string;
  /** 最近资料更新时间，ISO 8601。 */
  updated_at: string;
}

/** 全局本地用户仓储，不依赖登录服务或 Workspace。 */
export class UserRepository {
  /** user.json 的唯一物理位置。 */
  private readonly file_path: string;

  constructor(root_path?: string) {
    this.file_path = path.join(resolve_local_root_path(root_path), "user", "user.json");
  }

  /** 读取唯一使用者，不存在时排他创建；损坏时失败而不是重置身份。 */
  get(): LocalUser {
    if (!fs.pathExistsSync(this.file_path)) {
      const now = new Date().toISOString();
      const user: LocalUser = { user_id: LOCAL_USER_ID, display_name: "", created_at: now, updated_at: now };
      fs.ensureDirSync(path.dirname(this.file_path), { mode: 0o700 });
      try { fs.writeFileSync(this.file_path, `${JSON.stringify(user, null, 2)}\n`, { flag: "wx", mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    const user = fs.readJsonSync(this.file_path) as LocalUser;
    if (user.user_id !== LOCAL_USER_ID || typeof user.display_name !== "string" || !user.created_at || !user.updated_at) {
      throw new Error("Invalid local user information");
    }
    return user;
  }

  /** 仅修改基础资料，不能由调用方替换身份。 */
  update(input: { /** 本地使用者的显示名称。 */ display_name: string }): LocalUser {
    const user: LocalUser = { ...this.get(), display_name: input.display_name.trim(), updated_at: new Date().toISOString() };
    const temporary_path = `${this.file_path}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary_path, `${JSON.stringify(user, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporary_path, this.file_path);
    } finally { if (fs.pathExistsSync(temporary_path)) fs.unlinkSync(temporary_path); }
    return user;
  }
}
