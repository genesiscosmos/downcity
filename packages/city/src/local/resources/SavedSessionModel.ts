/** 读取既有宿主明确保存的 Session 模型覆盖；不从 Agent 默认值或展示 label 推断。 */
import path from "node:path";
import { LocalDatabase } from "../database/LocalDatabase.js";
import { LocalSettingRepository } from "../repositories/LocalSettingRepository.js";
import type { AgentSessionInfo } from "@downcity/agent";

/** 旧宿主精确地址的显式选择，供 CLI/Desktop 迁入 Session 自有模型记录。 */
export function read_saved_session_model(root_path: string, session: Pick<AgentSessionInfo, "agent_id" | "session_id" | "workspace_id" | "origin">, immutable: boolean): string | undefined {
  const database = new LocalDatabase({ filename: path.join(root_path, "downcity.db"), read_only: true, immutable });
  try {
    const settings = new LocalSettingRepository(database);
    const models = settings.get<Record<string, unknown>>("desktop.session-models");
    const key = [session.agent_id, session.workspace_id ?? "", session.session_id, session.origin.category, session.origin.type].join("\u0000");
    const model_id = models?.[key];
    return typeof model_id === "string" && model_id.trim() ? model_id.trim() : undefined;
  } finally { database.close(); }
}
