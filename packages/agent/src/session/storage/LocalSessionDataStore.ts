/**
 * 本地 Agent 单 Session 的 SQLite Storage。
 *
 * 本类只负责把 Agent 私有目录、数据库位置和附件目录装配给通用 SQLite 实现；
 * Session 领域不在这里拼接任何物理路径。
 */

import { LocalSessionAttachmentStore } from "@/session/storage/LocalSessionAttachmentStore.js";
import {
  get_agent_session_attachments_path,
  get_agent_session_database_path,
} from "@/session/storage/LocalStorePaths.js";
import { SqliteSessionStorage } from "@/session/storage/SqliteSessionStorage.js";
import type { LocalSessionDataStoreOptions } from "@/types/store/LocalStore.js";

/** Agent 私有 Session 的默认 SQLite Storage。 */
export class LocalSessionDataStore extends SqliteSessionStorage {
  constructor(options: LocalSessionDataStoreOptions) {
    super({
      session_id: options.session_id,
      agent_id: options.agent_id,
      ...(options.workspace_id ? { workspace_id: options.workspace_id } : {}),
      origin: options.origin,
      database_path: get_agent_session_database_path(
        options.storage_root_path,
        options.origin.type,
        options.session_id,
      ),
      database_location: options.database_location,
      files: options.files,
      attachments: new LocalSessionAttachmentStore({
        files: options.files,
        attachments_dir_path: get_agent_session_attachments_path(
          options.storage_root_path,
          options.origin.type,
          options.session_id,
        ),
      }),
    });
  }
}
