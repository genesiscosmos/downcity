/** Organizations Service 的数据库 Repository。 */

import { httpError, type CityTableApi, type ServiceTransactionContext } from "@downcity/city";
import type {
  OrganizationEventRecord,
  OrganizationJoinRequestRecord,
  OrganizationMembershipRecord,
  OrganizationOwnerSlotRecord,
  OrganizationRecord,
} from "../types/index.js";

/** Repository 可使用的表解析入口。 */
export interface OrganizationTableSource {
  /** 根据 Service 内部表名返回 Table API。 */
  table<TRow extends Record<string, unknown>>(name: string): CityTableApi<TRow>;
}

/** Organizations 多表数据访问入口。 */
export class OrganizationRepository {
  constructor(private readonly source: OrganizationTableSource | ServiceTransactionContext) {}

  /** 读取 Organization。 */
  async get_organization(organization_id: string): Promise<OrganizationRecord | undefined> {
    return (await this.organizations().select({ organization_id }))[0];
  }

  /** 读取必须存在的 Organization。 */
  async require_organization(organization_id: string): Promise<OrganizationRecord> {
    const organization = await this.get_organization(organization_id);
    if (!organization) throw httpError(404, "ORGANIZATION_NOT_FOUND");
    return organization;
  }

  /** 插入 Organization。 */
  insert_organization(organization: OrganizationRecord): Promise<void> {
    return this.organizations().insert(organization);
  }

  /** 更新 Organization。 */
  update_organization(
    organization_id: string,
    values: Partial<OrganizationRecord>,
  ): Promise<number> {
    return this.organizations().update({ where: { organization_id }, values });
  }

  /** 读取用户在 Organization 中的 active Membership。 */
  async get_active_membership(
    organization_id: string,
    user_id: string,
  ): Promise<OrganizationMembershipRecord | undefined> {
    return (await this.memberships().select({ organization_id, user_id, state: "active" }))[0];
  }

  /** 按 Membership ID 读取记录。 */
  async get_membership(membership_id: string): Promise<OrganizationMembershipRecord | undefined> {
    return (await this.memberships().select({ membership_id }))[0];
  }

  /** 读取 Organization 的 active Membership。 */
  list_active_memberships(organization_id: string): Promise<OrganizationMembershipRecord[]> {
    return this.memberships().select({ organization_id, state: "active" });
  }

  /** 读取用户当前全部 active Membership。 */
  list_user_active_memberships(user_id: string): Promise<OrganizationMembershipRecord[]> {
    return this.memberships().select({ user_id, state: "active" });
  }

  /** 插入新的 Membership；removed 记录永不复用。 */
  insert_membership(membership: OrganizationMembershipRecord): Promise<void> {
    return this.memberships().insert(membership);
  }

  /** 更新 Membership。 */
  update_membership(
    membership_id: string,
    values: Partial<OrganizationMembershipRecord>,
  ): Promise<number> {
    return this.memberships().update({ where: { membership_id }, values });
  }

  /** 读取用户当前 Owner 额度槽位。 */
  list_owner_slots(city_id: string, user_id: string): Promise<OrganizationOwnerSlotRecord[]> {
    return this.owner_slots().select({ city_id, user_id });
  }

  /** 按 Organization 读取 Owner 额度槽位。 */
  async get_owner_slot(organization_id: string): Promise<OrganizationOwnerSlotRecord | undefined> {
    return (await this.owner_slots().select({ organization_id }))[0];
  }

  /** 占用 Owner 额度槽位。 */
  insert_owner_slot(slot: OrganizationOwnerSlotRecord): Promise<void> {
    return this.owner_slots().insert(slot);
  }

  /** 释放 Owner 额度槽位。 */
  delete_owner_slot(organization_id: string): Promise<number> {
    return this.owner_slots().delete({ organization_id });
  }

  /** 读取用户当前 pending Join Request。 */
  async get_pending_join_request(
    organization_id: string,
    user_id: string,
  ): Promise<OrganizationJoinRequestRecord | undefined> {
    return (await this.join_requests().select({ organization_id, user_id, state: "pending" }))[0];
  }

  /** 按 ID 读取 Join Request。 */
  async get_join_request(request_id: string): Promise<OrganizationJoinRequestRecord | undefined> {
    return (await this.join_requests().select({ request_id }))[0];
  }

  /** 读取 Organization 的 pending Join Request。 */
  list_pending_join_requests(organization_id: string): Promise<OrganizationJoinRequestRecord[]> {
    return this.join_requests().select({ organization_id, state: "pending" });
  }

  /** 插入 Join Request。 */
  insert_join_request(request: OrganizationJoinRequestRecord): Promise<void> {
    return this.join_requests().insert(request);
  }

  /** 更新 Join Request。 */
  update_join_request(
    request_id: string,
    values: Partial<OrganizationJoinRequestRecord>,
  ): Promise<number> {
    return this.join_requests().update({ where: { request_id }, values });
  }

  /** 插入领域 Event。 */
  insert_event(event: OrganizationEventRecord): Promise<void> {
    return this.events().insert(event);
  }

  /** 读取待投递 Event。 */
  list_pending_events(): Promise<OrganizationEventRecord[]> {
    return this.events().select({ delivery_state: "pending" });
  }

  /** 更新 Event 投递状态。 */
  update_event(event_id: string, values: Partial<OrganizationEventRecord>): Promise<number> {
    return this.events().update({ where: { event_id }, values });
  }

  private organizations(): CityTableApi<OrganizationRecord> {
    return this.source.table<OrganizationRecord>("organizations");
  }

  private memberships(): CityTableApi<OrganizationMembershipRecord> {
    return this.source.table<OrganizationMembershipRecord>("memberships");
  }

  private owner_slots(): CityTableApi<OrganizationOwnerSlotRecord> {
    return this.source.table<OrganizationOwnerSlotRecord>("owner_slots");
  }

  private join_requests(): CityTableApi<OrganizationJoinRequestRecord> {
    return this.source.table<OrganizationJoinRequestRecord>("join_requests");
  }

  private events(): CityTableApi<OrganizationEventRecord> {
    return this.source.table<OrganizationEventRecord>("events");
  }
}
