/**
 * Agent 私有执行身份检查点：每个 Session 仅保存最近一次执行的 Turn 和代次。
 * Loop 在调用模型及工具前等待原子保存；重启后的停止沿用该身份封闭迟到委派。
 * 使用 Agent 的 FileSystem，独立 SDK 的内存存储与 City 持久化存储遵循同一协议。
 */
import { createHash } from "node:crypto";
import type { FileSystem } from "@downcity/type";
import type { SessionExecutionIdentity, SessionExecutionIdentityStore } from "@/types/session/SessionExecutionIdentity.js";

/** 不持有运行对象，也不复制执行结果；只维护恢复所需的身份。 */
export class LocalSessionExecutionIdentityStore implements SessionExecutionIdentityStore {
  constructor(private readonly files: FileSystem) {}

  /** 损坏的身份必须明确失败，不能用新代次绕过已有取消范围。 */
  async read(session_id: string, type: string): Promise<SessionExecutionIdentity | undefined> {
    const path = this.identity_path(session_id, type);
    if (!await this.files.path_exists(path)) return undefined;
    const identity = JSON.parse((await this.files.read_file(path)).toString("utf8")) as SessionExecutionIdentity;
    this.assert_identity(identity);
    return identity;
  }

  /** SessionLoop 是同一 Session 的唯一写者；文件原子替换避免恢复读取半份身份。 */
  async write(session_id: string, type: string, identity: SessionExecutionIdentity): Promise<void> {
    this.assert_identity(identity);
    await this.files.ensure_directory("executions");
    await this.files.write_file_atomically(this.identity_path(session_id, type), JSON.stringify(identity));
  }

  private assert_identity(identity: SessionExecutionIdentity): void {
    if (!identity || typeof identity.turn_id !== "string" || !identity.turn_id.trim()
      || typeof identity.execution_id !== "string" || !identity.execution_id.trim()) {
      throw new Error("Invalid Session execution identity");
    }
  }

  private identity_path(session_id: string, type: string): string {
    const key = createHash("sha256").update(JSON.stringify([type, session_id])).digest("hex");
    return `executions/${key}.json`;
  }
}
