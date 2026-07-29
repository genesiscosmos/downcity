/** Organizations Service 撤权事件可靠投递器。 */

import type {
  CreateFederationServiceTokenInput,
  FederationServiceTokenIssueResult,
} from "@downcity/city";
import type { OrganizationEventRecord } from "../types/index.js";
import { OrganizationRepository } from "./OrganizationRepository.js";

/** 单次 Outbox 投递结果。 */
export interface OrganizationEventDeliveryResult {
  /** 本次成功投递数量。 */
  delivered: number;
  /** 投递后仍为 pending 的数量。 */
  pending: number;
}

/** 撤权事件 Outbox 投递器。 */
export class OrganizationEventDispatcher {
  constructor(
    private readonly repository: OrganizationRepository,
    private readonly create_service_token: (
      input: CreateFederationServiceTokenInput,
    ) => Promise<FederationServiceTokenIssueResult>,
    private readonly fetcher: typeof fetch,
  ) {}

  /** 按创建时间投递一批 pending Event。 */
  async deliver_pending(limit = 50): Promise<OrganizationEventDeliveryResult> {
    const events = (await this.repository.list_pending_events())
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .slice(0, limit);
    let delivered = 0;
    for (const event of events) {
      if (await this.deliver_event(event)) delivered += 1;
    }
    return {
      delivered,
      // 当前批次可能只取前 50 条；必须读取完整 Outbox，避免剩余事件失去后续调度。
      pending: (await this.repository.list_pending_events()).length,
    };
  }

  /** 签名并投递单个撤权 Event。 */
  private async deliver_event(event: OrganizationEventRecord): Promise<boolean> {
    try {
      const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
      const signed = await this.create_service_token({
        audience: event.target_url,
        subject: event.event_id,
        prefix: "oe_",
        ttl: "5m",
        claims: payload,
      });
      const response = await this.fetcher(
        `${event.target_url.replace(/\/+$/u, "")}/v1/downcity/organization-events`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({ event_token: signed.token }),
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) throw new Error(`City Server returned HTTP ${response.status}`);
      await this.repository.update_event(event.event_id, {
        delivery_state: "delivered",
        delivery_attempts: event.delivery_attempts + 1,
        last_error: "",
        delivered_at: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      await this.repository.update_event(event.event_id, {
        delivery_attempts: event.delivery_attempts + 1,
        last_error: String(error instanceof Error ? error.message : error).slice(0, 2_000),
      });
      return false;
    }
  }
}
