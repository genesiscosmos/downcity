/** CLI 选择器直接派生共用用例的结果类型，避免复制 DTO 字段与运行协议。 */
import type { ResourceService } from "@downcity/city/local";

/** Agent 列表的原始业务结果，不包含 JSON envelope。 */
export type AgentListData = ReturnType<ResourceService["agents"]["list"]>;
/** Agent 详情及引用概况。 */
export type AgentGetData = Awaited<ReturnType<ResourceService["agents"]["get"]>>;
/** 项目登记与运行索引的并集。 */
export type WorkspaceListData = Awaited<ReturnType<ResourceService["workspaces"]["list"]>>;
/** 会话分页、canonical 来源与运行观察。 */
export type SessionListData = Awaited<ReturnType<ResourceService["sessions"]["list"]>>;
/** 持久化会话详情、归档标记和运行观察。 */
export type SessionGetData = Awaited<ReturnType<ResourceService["sessions"]["get"]>>;
/** 普通工作会话创建结果。 */
export type SessionCreateData = Awaited<ReturnType<ResourceService["sessions"]["create"]>>;
