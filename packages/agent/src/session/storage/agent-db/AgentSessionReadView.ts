/**
 * 目标 Agent DB 的只读投影；元数据、消息和配置独立查询。
 * 所有视图操作重新校验记录身份和归档状态，防止归档重建后旧活动地址读到新记录。
 */
import { normalize_session_descriptor } from "@downcity/type";
import type { AgentSessionRecord, AgentSessionConfigurationRow } from "@/types/store/AgentSessionDatabase.js";
import type { AgentSessionRuntimeLease } from "@/types/store/AgentSessionRuntime.js";
import type { AgentSessionMessagePage } from "@/types/store/AgentSessionMessages.js";
import type { SessionReadView } from "@/types/store/SessionReadView.js";
import type { SessionHistoryMeta } from "@/types/store/SessionHistoryMeta.js";
import type { AgentSessionSummary } from "@/types/agent/SessionTypes.js";
import type { SessionMessage } from "@downcity/type";
import { collect_pending_interactions } from "../SessionInteractionReader.js";
import { decode_session_record } from "./AgentSessionRelations.js";

/** 小字段事实投影，列表不 JOIN configuration 或正文。 */
export function project_agent_session_record(agent_id: string, row: AgentSessionRecord): AgentSessionSummary {
  return { id: row.session_id,
    ...normalize_session_descriptor(decode_session_record(row)), message_count: row.message_count,
    created_at: row.created_at, updated_at: row.updated_at,
    ...(row.title ? { title: row.title } : {}), ...(row.preview_text ? { preview_text: row.preview_text } : {}),
    ...(row.workspace_id ? { workspace_id: row.workspace_id } : {}), ...(row.model_label ? { model_label: row.model_label } : {}),
  };
}

/** 同库记录投影为领域元数据，只有执行配置读取显式传入时才包含大字段相关配置。 */
export function project_agent_session_metadata(agent_id: string, row: AgentSessionRecord, configuration?: AgentSessionConfigurationRow): SessionHistoryMeta {
  const { id, ...summary } = project_agent_session_record(agent_id, row);
  return { ...summary, session_id: id, agent_id, v: 2, timezone: row.timezone, updated_at: row.updated_at,
    ...(configuration?.approval_mode ? { approval_mode: configuration.approval_mode } : {}),
    ...(configuration?.execution_profile ? { execution_profile: JSON.parse(configuration.execution_profile) } : {}),
  };
}

/** 保留精确记录引用，不恢复 Session 或执行环境。 */
export function agent_session_read_view(lease: AgentSessionRuntimeLease, agent_id: string, row: AgentSessionRecord): SessionReadView {
  const archived = Boolean(row.archived);
  const assert_record = async () => {
    const current = await lease.read<AgentSessionRecord | null>({ command: "find", address: archived
      ? { archived: true, session_id: row.session_id }
      : { archived: false, type: row.type, session_id: row.session_id } });
    if (!current || current.session_id !== row.session_id) throw new Error("session_address_changed");
  };
  return {
    session_id: row.session_id, metadata: project_agent_session_metadata(agent_id, row), archived,
    configuration: async () => {
      await assert_record();
      const config = await lease.read<AgentSessionConfigurationRow>({ command: "configuration", session_id: row.session_id });
      return { system_snapshot: config.system_snapshot,
        ...(config.approval_mode ? { approval_mode: config.approval_mode } : {}),
        ...(config.execution_profile ? { execution_profile: JSON.parse(config.execution_profile) } : {}),
      };
    },
    messages: async (input) => {
      await assert_record();
      const limit = input?.limit ?? 50;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("session_message_page_limit_invalid");
      const page = await lease.read<AgentSessionMessagePage>({ command: "messages", session_id: row.session_id,
        input: { before_sequence: input?.before_sequence, limit: limit + 1 } });
      const has_more = page.items.length > limit;
      const items = has_more ? page.items.slice(1) : page.items;
      const start_sequence = items[0]?.sequence;
      const end_sequence = items.at(-1)?.sequence;
      return { items, total: page.total, has_more,
        ...(start_sequence === undefined ? {} : { start_sequence }), ...(end_sequence === undefined ? {} : { end_sequence }),
        ...(has_more && start_sequence !== undefined ? { next_before_sequence: start_sequence } : {}),
      };
    },
    interactions: async () => {
      await assert_record();
      const messages = await lease.read<SessionMessage[]>({ command: "recoverable", session_id: row.session_id });
      return collect_pending_interactions(messages).map(entry => structuredClone(entry.request));
    },
  };
}
