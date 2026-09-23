/**
 * Messenger Access 应用服务。
 *
 * 关键点（中文）
 * - 所有平台共用相同的 Principal、Grant、Request 和 Audit 业务规则。
 * - Messenger Access 只做准入判定，不向 Agent Session 或其他 Power 传播权限。
 * - 每个方法自行打开并关闭 Messenger Power 生命周期 Store，避免 Connector 生命周期遗漏连接释放。
 */

import path from "node:path";
import { MessengerAccessStore } from "@/messenger/access/MessengerAccessStore.js";
import type {
  ApproveMessengerAccessRequestInput,
  MessengerAccessDecision,
  MessengerAccessEffect,
  MessengerAccessGrant,
  MessengerAccessIdentityInput,
  MessengerAccessPrincipal,
  MessengerAccessPrincipalView,
  MessengerAccessRequestStatus,
  MessengerAccessRequestView,
  MessengerAccessScope,
  MessengerAccessScopeInput,
  MessengerAccessServiceOptions,
  MessengerAccessSnapshot,
  DenyMessengerAccessRequestInput,
  RevokeMessengerAccessGrantInput,
  SetMessengerAccessPrincipalEffectInput,
} from "@/messenger/types/MessengerAccess.js";
import type { MessengerDispatchChannel } from "@/messenger/types/MessengerDispatcher.js";

const CHANNELS: MessengerDispatchChannel[] = ["telegram", "feishu"];

function normalize_text(value: unknown): string {
  return String(value || "").trim();
}

/** 判断是否为 Messenger Access 支持渠道。 */
export function is_messenger_access_channel(value: unknown): value is MessengerDispatchChannel {
  return CHANNELS.includes(normalize_text(value).toLowerCase() as MessengerDispatchChannel);
}

/** 解析管理输入范围。 */
export function resolve_messenger_access_scopes(scope: MessengerAccessScopeInput): MessengerAccessScope[] {
  if (scope === "all") return ["direct", "group"];
  if (scope === "direct" || scope === "group") return [scope];
  throw new Error(`Invalid Messenger Access scope: ${scope}`);
}

/** 根据平台会话类型解析准入范围。 */
export function resolve_messenger_access_scope(
  channel: MessengerDispatchChannel,
  chat_type?: string,
): MessengerAccessScope {
  const type = normalize_text(chat_type).toLowerCase();
  if (!type) return "direct";
  if (channel === "telegram") return type === "private" ? "direct" : "group";
  return type === "p2p" ? "direct" : "group";
}

/**
 * 当前 Messenger Power 的 Bot Account Access 应用服务。
 */
export class MessengerAccessService {
  private readonly data_path: string;
  constructor(options: MessengerAccessServiceOptions) {
    this.data_path = path.resolve(normalize_text(options.data_path) || ".");
  }

  private with_store<T>(operation: (store: MessengerAccessStore) => T): T {
    const store = new MessengerAccessStore(this.data_path);
    try {
      return operation(store);
    } finally {
      store.close();
    }
  }

  /** 观测并规范化平台主体。 */
  observe_identity(input: MessengerAccessIdentityInput): MessengerAccessPrincipal {
    const channel = input.channel;
    const issuer = normalize_text(input.issuer);
    const subject_id = normalize_text(input.subject_id);
    const chat_id = normalize_text(input.chat_id);
    if (!is_messenger_access_channel(channel)) throw new Error(`Invalid Messenger Access channel: ${channel}`);
    if (!issuer) throw new Error("Messenger Access issuer is required");
    if (!subject_id) throw new Error("Messenger Access subject_id is required");
    if (!chat_id) throw new Error("Messenger Access chat_id is required");
    return this.with_store((store) => store.upsert_principal({
      channel,
      issuer,
      subject_id,
      display_name: normalize_text(input.display_name) || undefined,
      chat_id,
      chat_type: normalize_text(input.chat_type) || undefined,
    }));
  }

  /** 判定当前消息是否允许进入 Agent。 */
  evaluate(input: MessengerAccessIdentityInput): MessengerAccessDecision {
    const scope = resolve_messenger_access_scope(input.channel, input.chat_type);
    const issuer = normalize_text(input.issuer);
    const subject_id = normalize_text(input.subject_id);
    const chat_id = normalize_text(input.chat_id);
    if (!issuer || !subject_id || !chat_id) {
      return {
        allowed: false,
        principal_id: "",
        scope,
        reason: "identity_missing",
      };
    }

    return this.with_store((store) => store.transaction(() => {
      const principal = store.upsert_principal({
        channel: input.channel,
        issuer,
        subject_id,
        display_name: normalize_text(input.display_name) || undefined,
        chat_id,
        chat_type: normalize_text(input.chat_type) || undefined,
      });
      const grant = store.get_grant(principal.principal_id, scope);
      if (grant?.effect === "deny") {
        store.insert_audit_event({
          principal_id: principal.principal_id,
          action: "message_blocked",
          scope,
          decision: "deny",
          detail: { reason: "grant_denied" },
        });
        return {
          allowed: false,
          principal_id: principal.principal_id,
          scope,
          reason: "grant_denied",
        };
      }
      if (grant?.effect === "allow") {
        store.insert_audit_event({
          principal_id: principal.principal_id,
          action: "message_allowed",
          scope,
          decision: "allow",
        });
        return {
          allowed: true,
          principal_id: principal.principal_id,
          scope,
          reason: "grant_allowed",
        };
      }

      const request_result = store.create_or_touch_request({
        principal_id: principal.principal_id,
        scope,
        chat_id,
        chat_type: normalize_text(input.chat_type),
      });
      store.insert_audit_event({
        principal_id: principal.principal_id,
        request_id: request_result.request.request_id,
        action: request_result.created ? "request_created" : "request_reused",
        scope,
        decision: "block",
      });
      return {
        allowed: false,
        principal_id: principal.principal_id,
        scope,
        reason: "request_pending",
        request_id: request_result.request.request_id,
      };
    }));
  }

  /** 批准待处理请求。 */
  approve_request(input: ApproveMessengerAccessRequestInput): MessengerAccessGrant[] {
    return this.resolve_request_with_effect({
      request_id: input.request_id,
      scope: input.scope,
      operator: input.operator,
      effect: "allow",
    });
  }

  /** 拒绝待处理请求。 */
  deny_request(input: DenyMessengerAccessRequestInput): MessengerAccessGrant[] {
    return this.resolve_request_with_effect({
      request_id: input.request_id,
      scope: input.scope,
      operator: input.operator,
      effect: "deny",
    });
  }

  private resolve_request_with_effect(input: {
    request_id: string;
    scope?: MessengerAccessScopeInput;
    operator: string;
    effect: MessengerAccessEffect;
  }): MessengerAccessGrant[] {
    const request_id = normalize_text(input.request_id);
    const operator = normalize_text(input.operator) || "unknown";
    if (!request_id) throw new Error("Messenger Access request_id is required");
    return this.with_store((store) => store.transaction(() => {
      const request = store.get_request(request_id);
      if (!request || request.status !== "pending") {
        throw new Error(`Pending Messenger Access request not found: ${request_id}`);
      }
      const scopes = resolve_messenger_access_scopes(input.scope || request.scope);
      const grants = scopes.map((scope) => store.upsert_grant({
        principal_id: request.principal_id,
        scope,
        effect: input.effect,
        operator,
      }));
      const status = input.effect === "allow" ? "approved" : "denied";
      store.resolve_pending_requests({
        principal_id: request.principal_id,
        scopes,
        status,
        operator,
      });
      store.insert_audit_event({
        principal_id: request.principal_id,
        request_id,
        action: input.effect === "allow" ? "request_approved" : "request_denied",
        scope: request.scope,
        decision: input.effect,
        operator,
        detail: { scopes },
      });
      return grants;
    }));
  }

  /** 直接设置已知主体的 Allow/Deny。 */
  set_principal_effect(input: SetMessengerAccessPrincipalEffectInput): MessengerAccessGrant[] {
    const principal_id = normalize_text(input.principal_id);
    const operator = normalize_text(input.operator) || "unknown";
    if (!principal_id) throw new Error("Messenger Access principal_id is required");
    return this.with_store((store) => store.transaction(() => {
      const principal = store.get_principal(principal_id);
      if (!principal) throw new Error(`Messenger Access principal not found: ${principal_id}`);
      const scopes = resolve_messenger_access_scopes(input.scope);
      const grants = scopes.map((scope) => store.upsert_grant({
        principal_id,
        scope,
        effect: input.effect,
        operator,
      }));
      store.resolve_pending_requests({
        principal_id,
        scopes,
        status: input.effect === "allow" ? "approved" : "denied",
        operator,
      });
      store.insert_audit_event({
        principal_id,
        action: "grant_updated",
        decision: input.effect,
        operator,
        detail: { scopes },
      });
      return grants;
    }));
  }

  /** 撤销主体指定范围的 Grant。 */
  revoke_grant(input: RevokeMessengerAccessGrantInput): number {
    const principal_id = normalize_text(input.principal_id);
    const operator = normalize_text(input.operator) || "unknown";
    if (!principal_id) throw new Error("Messenger Access principal_id is required");
    return this.with_store((store) => store.transaction(() => {
      const principal = store.get_principal(principal_id);
      if (!principal) throw new Error(`Messenger Access principal not found: ${principal_id}`);
      const scopes = resolve_messenger_access_scopes(input.scope);
      let removed_count = 0;
      for (const scope of scopes) {
        if (store.delete_grant(principal_id, scope)) removed_count += 1;
      }
      store.insert_audit_event({
        principal_id,
        action: "grant_revoked",
        operator,
        detail: { scopes, removed_count },
      });
      return removed_count;
    }));
  }

  /** 列出主体和 Grant。 */
  list_principals(): MessengerAccessPrincipalView[] {
    return this.with_store((store) => store.list_principals());
  }

  /** 列出 Access Request。 */
  list_requests(status?: MessengerAccessRequestStatus): MessengerAccessRequestView[] {
    return this.with_store((store) => store.list_requests(status));
  }

  /** 读取完整 Messenger Access 快照。 */
  snapshot(): MessengerAccessSnapshot {
    return this.with_store((store) => ({
      principals: store.list_principals(),
      requests: store.list_requests(),
    }));
  }
}
