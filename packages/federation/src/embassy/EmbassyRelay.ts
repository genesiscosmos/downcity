/**
 * Embassy 中转管理 SDK。
 * 用户入口沿用当前登录身份，管理员入口沿用 Admin Session。签发结果包含一次性
 * 明文，列表和更新只返回可展示信息。外部推理客户端使用标准 /v1 接口。
 */
import type { ServiceClient } from "../pact/invoker/invoker.js";
import type {
  RelayCatalog, RelayKeyInfo, RelayKeyIssued, RelayKeyPolicy, RelayKeyUpdate, RelayLogQuery,
  RelayKeyList, RelayRequestPage, RelayAttemptList, RelayCatalogSnapshot, RelayCatalogUpdated,
} from "../types/Relay.js";

/** 登录用户自己的 Key 与调用日志。 */
export class EmbassyRelay {
  constructor(private readonly service: () => ServiceClient) {}

  create_key(input: RelayKeyPolicy): Promise<RelayKeyIssued> {
    return this.service().action("keys/create").invoke({ ...input });
  }

  list_keys(): Promise<RelayKeyList> {
    return this.service().get("keys/list");
  }

  update_key(input: RelayKeyUpdate): Promise<RelayKeyInfo> {
    return this.service().action("keys/update").invoke({ ...input });
  }

  revoke_key(key_id: string): Promise<RelayKeyInfo> {
    return this.service().action("keys/revoke").invoke({ key_id });
  }

  list_requests(query: RelayLogQuery = {}): Promise<RelayRequestPage> {
    return this.service().get("relay/requests", { ...query });
  }

  list_attempts(request_id: string): Promise<RelayAttemptList> {
    return this.service().get("relay/attempts", { request_id });
  }
}

/** 管理员目录与全局请求查询，不持有渠道明文凭据。 */
export class EmbassyRelayAdmin {
  constructor(private readonly service: () => ServiceClient) {}

  catalog(): Promise<RelayCatalogSnapshot> {
    return this.service().get("relay/catalog");
  }

  configure(catalog: RelayCatalog, revision: number): Promise<RelayCatalogUpdated> {
    return this.service().action("relay/configure").invoke({ catalog, revision });
  }

  list_requests(query: RelayLogQuery = {}): Promise<RelayRequestPage> {
    return this.service().get("relay/admin/requests", { ...query });
  }

  list_attempts(request_id: string): Promise<RelayAttemptList> {
    return this.service().get("relay/admin/attempts", { request_id });
  }
}
