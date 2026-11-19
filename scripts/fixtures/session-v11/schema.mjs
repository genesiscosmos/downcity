/** 冻结的 v11 离线协议，仅供显式迁移和历史校验使用。 */
/** 与每 Session v7 分库明确区分的 Agent DB 格式。 */
export const AGENT_SESSION_SCHEMA_VERSION = 11;
/** 校验版本和数据库拥有者；只读调用绝不初始化数据库。 */
export function assert_agent_session_schema(database, agent_id) {
    const version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version !== AGENT_SESSION_SCHEMA_VERSION) {
        const database_path = database.prepare("PRAGMA database_list").all().find(row => row.name === "main")?.file || ":memory:";
        throw new Error(`session_migration_required: Agent Session storage requires offline migration; agent_id=${agent_id}; database_path=${database_path}; actual_version=${version}; expected_version=${AGENT_SESSION_SCHEMA_VERSION}`);
    }
    const metadata = database.prepare("SELECT agent_id, format_version FROM storage_metadata WHERE singleton_id = 1").get();
    if (metadata?.agent_id !== agent_id || metadata.format_version !== AGENT_SESSION_SCHEMA_VERSION) {
        throw new Error("session_storage_identity_conflict: Agent database identity does not match");
    }
}
