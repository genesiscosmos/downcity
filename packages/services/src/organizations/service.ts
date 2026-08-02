/**
 * Downcity Organizations Service 领域实现。
 *
 * 设计边界：
 * - Federation 是 Organization 与 Membership 的唯一权威事实源；
 * - Organization 可以属于 Federation 全局，也可以限定在当前 Token Bureau；
 * - 产品后端、部署路由、项目资源和产品权限不属于本 Service。
 */

import {
  InstallableService,
  httpError,
  type ServiceInstallContext,
  type ServiceTransactionContext,
} from "@downcity/city";
import { organization_database_schemas } from "./schema/index.js";
import {
  new_join_request_id,
  new_membership_id,
  new_organization_id,
} from "./domain/OrganizationId.js";
import {
  read_include_archived,
  read_assignable_role,
  read_join_decision,
  read_membership_id,
  read_organization_id,
  read_organization_name,
  read_request_id,
  read_scope_type,
  require_role,
} from "./domain/OrganizationPolicy.js";
import { OrganizationRepository, type OrganizationTableSource } from "./infrastructure/OrganizationRepository.js";
import { register_organization_routes } from "./routes.js";
import type {
  OrganizationCreateInput,
  OrganizationIdInput,
  OrganizationJoinRequestDecisionInput,
  OrganizationJoinRequestIdInput,
  OrganizationJoinRequestRecord,
  OrganizationListMyInput,
  OrganizationMemberRemoveInput,
  OrganizationMemberRoleInput,
  OrganizationMembershipRecord,
  OrganizationOwnerSlotRecord,
  OrganizationOwnerTransferInput,
  OrganizationRecord,
  OrganizationsServiceOptions,
  OrganizationUpdateInput,
  UserOrganization,
} from "./types/index.js";

/** Organizations Service 实例。 */
export class OrganizationsService extends InstallableService {
  readonly id = "organizations";
  readonly name = "Organizations";
  readonly version = "2.0.0";
  readonly database_schemas = organization_database_schemas;

  private readonly max_organizations_per_user: number;
  private repository?: OrganizationRepository;
  private transaction_runner?: <TResult>(
    handler: (context: ServiceTransactionContext) => Promise<TResult>,
  ) => Promise<TResult>;

  constructor(options: OrganizationsServiceOptions) {
    super();
    if (!options || !Number.isSafeInteger(options.max_organizations_per_user)
      || options.max_organizations_per_user <= 0) {
      throw new TypeError("max_organizations_per_user must be a positive integer");
    }
    this.max_organizations_per_user = options.max_organizations_per_user;
    this.instruction = [
      "管理 Federation 全局或当前 Bureau 作用域的 Organization、Membership 与用户主动 Join Request。",
      "Organization 只表达组织身份、成员关系和治理角色。",
      "产品后端、部署路由、项目资源和产品权限由 Bureau、Product 与 Bureau 管理。",
    ].join("\n");
  }

  /** 安装数据访问能力与 HTTP Action。 */
  install(context: ServiceInstallContext): void {
    const source: OrganizationTableSource = {
      table: (name) => context.table(name),
    };
    this.repository = new OrganizationRepository(source);
    this.transaction_runner = (handler) => context.transaction(handler);
    register_organization_routes(this, context);
  }

  /** 创建 Organization 并让当前用户成为唯一 Owner。 */
  async create(user_id: string, bureau_id: string, input: OrganizationCreateInput) {
    const name = read_organization_name(input.name);
    const scope_type = read_scope_type(input.scope_type);
    return await this.with_owner_slot_retry(async () => this.transaction(async (repository) => {
      const now = new Date().toISOString();
      const organization_id = new_organization_id();
      const slot = await this.reserve_owner_slot(repository, user_id, organization_id, now);
      const organization: OrganizationRecord = {
        organization_id,
        name,
        scope_type,
        scope_bureau_id: scope_type === "bureau" ? bureau_id : "",
        state: "active",
        created_by: user_id,
        created_at: now,
        updated_at: now,
        archived_at: "",
      };
      const membership: OrganizationMembershipRecord = {
        membership_id: new_membership_id(),
        organization_id,
        user_id,
        role: "owner",
        state: "active",
        created_at: now,
        updated_at: now,
        removed_at: "",
        removed_by: "",
      };
      await repository.insert_organization(organization);
      await repository.insert_owner_slot(slot);
      await repository.insert_membership(membership);
      return { organization, membership };
    }));
  }

  /** 列出当前 Token Bureau 可见且用户仍有 active Membership 的 Organization。 */
  async list_my(
    user_id: string,
    bureau_id: string,
    input: OrganizationListMyInput = {},
  ): Promise<UserOrganization[]> {
    const include_archived = read_include_archived(input.include_archived);
    const memberships = await this.repo().list_user_active_memberships(user_id);
    const items: UserOrganization[] = [];
    for (const membership of memberships) {
      const organization = await this.repo().get_organization(membership.organization_id);
      if (!organization || !this.is_visible_in_bureau(organization, bureau_id)) continue;
      if (!include_archived && organization.state === "archived") continue;
      items.push({
        ...organization,
        role: membership.role,
        membership_id: membership.membership_id,
        membership_state: membership.state,
      });
    }
    return items.sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  /** 读取当前用户已加入的 Organization。 */
  async get_organization(user_id: string, bureau_id: string, input: OrganizationIdInput) {
    const organization_id = read_organization_id(input.organization_id);
    const organization = await this.require_visible_organization(this.repo(), organization_id, bureau_id);
    const membership = require_role(
      await this.repo().get_active_membership(organization_id, user_id),
      ["owner", "admin", "member"],
    );
    return { organization, membership };
  }

  /** 修改 Organization 名称。 */
  async update(user_id: string, bureau_id: string, input: OrganizationUpdateInput) {
    const organization_id = read_organization_id(input.organization_id);
    const name = read_organization_name(input.name);
    return await this.transaction(async (repository) => {
      const organization = await this.require_active_visible_organization(repository, organization_id, bureau_id);
      require_role(await repository.get_active_membership(organization_id, user_id), ["owner", "admin"]);
      const updated_at = new Date().toISOString();
      await repository.update_organization(organization_id, { name, updated_at });
      return { ...organization, name, updated_at };
    });
  }

  /** 将 Organization 归档为不可恢复终态。 */
  async archive(user_id: string, bureau_id: string, input: OrganizationIdInput) {
    const organization_id = read_organization_id(input.organization_id);
    return await this.transaction(async (repository) => {
      const organization = await this.require_active_visible_organization(repository, organization_id, bureau_id);
      require_role(await repository.get_active_membership(organization_id, user_id), ["owner"]);
      const archived_at = new Date().toISOString();
      await repository.update_organization(organization_id, {
        state: "archived",
        archived_at,
        updated_at: archived_at,
      });
      await repository.delete_owner_slot(organization_id);
      return { ...organization, state: "archived" as const, archived_at, updated_at: archived_at };
    });
  }

  /** 读取当前用户 Membership。 */
  async get_membership(user_id: string, bureau_id: string, input: OrganizationIdInput) {
    const organization_id = read_organization_id(input.organization_id);
    const organization = await this.require_visible_organization(this.repo(), organization_id, bureau_id);
    const membership = require_role(
      await this.repo().get_active_membership(organization_id, user_id),
      ["owner", "admin", "member"],
    );
    return { organization, membership };
  }

  /** 列出 active Membership。 */
  async list_members(user_id: string, bureau_id: string, input: OrganizationIdInput) {
    const organization_id = read_organization_id(input.organization_id);
    await this.require_active_visible_organization(this.repo(), organization_id, bureau_id);
    require_role(await this.repo().get_active_membership(organization_id, user_id), ["owner", "admin", "member"]);
    return await this.repo().list_active_memberships(organization_id);
  }

  /** Owner 任命或撤销 Admin。 */
  async update_member_role(user_id: string, bureau_id: string, input: OrganizationMemberRoleInput) {
    const organization_id = read_organization_id(input.organization_id);
    const membership_id = read_membership_id(input.membership_id);
    const role = read_assignable_role(input.role);
    return await this.transaction(async (repository) => {
      await this.require_active_visible_organization(repository, organization_id, bureau_id);
      require_role(await repository.get_active_membership(organization_id, user_id), ["owner"]);
      const target = await repository.get_membership(membership_id);
      if (!target || target.organization_id !== organization_id || target.state !== "active") {
        throw httpError(404, "ORGANIZATION_MEMBERSHIP_NOT_FOUND");
      }
      if (target.role === "owner") throw httpError(409, "OWNER_TRANSFER_REQUIRED");
      const updated_at = new Date().toISOString();
      await repository.update_membership(membership_id, { role, updated_at });
      return { ...target, role, updated_at };
    });
  }

  /** Owner/Admin 移除允许其管理的 Membership。 */
  async remove_member(user_id: string, bureau_id: string, input: OrganizationMemberRemoveInput) {
    const organization_id = read_organization_id(input.organization_id);
    const membership_id = read_membership_id(input.membership_id);
    return await this.transaction(async (repository) => {
      await this.require_active_visible_organization(repository, organization_id, bureau_id);
      const actor = require_role(
        await repository.get_active_membership(organization_id, user_id),
        ["owner", "admin"],
      );
      const target = await repository.get_membership(membership_id);
      if (!target || target.organization_id !== organization_id || target.state !== "active") {
        throw httpError(404, "ORGANIZATION_MEMBERSHIP_NOT_FOUND");
      }
      if (target.role === "owner") throw httpError(409, "OWNER_TRANSFER_REQUIRED");
      if (actor.role === "admin" && target.role !== "member") {
        throw httpError(403, "ORGANIZATION_ROLE_DENIED");
      }
      return await this.remove_membership(repository, target, user_id);
    });
  }

  /** Member/Admin 主动退出 Organization。 */
  async leave(user_id: string, bureau_id: string, input: OrganizationIdInput) {
    const organization_id = read_organization_id(input.organization_id);
    return await this.transaction(async (repository) => {
      await this.require_active_visible_organization(repository, organization_id, bureau_id);
      const membership = require_role(
        await repository.get_active_membership(organization_id, user_id),
        ["owner", "admin", "member"],
      );
      if (membership.role === "owner") throw httpError(409, "OWNER_TRANSFER_REQUIRED");
      return await this.remove_membership(repository, membership, user_id);
    });
  }

  /** 原子转移唯一 Owner 和额度槽位。 */
  async transfer_owner(user_id: string, bureau_id: string, input: OrganizationOwnerTransferInput) {
    const organization_id = read_organization_id(input.organization_id);
    const membership_id = read_membership_id(input.membership_id);
    return await this.with_owner_slot_retry(async () => this.transaction(async (repository) => {
      await this.require_active_visible_organization(repository, organization_id, bureau_id);
      const current_owner = require_role(
        await repository.get_active_membership(organization_id, user_id),
        ["owner"],
      );
      const target = await repository.get_membership(membership_id);
      if (!target || target.organization_id !== organization_id || target.state !== "active") {
        throw httpError(404, "ORGANIZATION_MEMBERSHIP_NOT_FOUND");
      }
      if (target.role === "owner") return { previous_owner: current_owner, owner: target };
      const now = new Date().toISOString();
      const slot = await this.create_owner_slot(repository, target.user_id, organization_id, now);
      await repository.delete_owner_slot(organization_id);
      await repository.insert_owner_slot(slot);
      await repository.update_membership(current_owner.membership_id, { role: "admin", updated_at: now });
      await repository.update_membership(target.membership_id, { role: "owner", updated_at: now });
      return {
        previous_owner: { ...current_owner, role: "admin" as const, updated_at: now },
        owner: { ...target, role: "owner" as const, updated_at: now },
      };
    }));
  }

  /** 用户主动申请加入 Organization。 */
  async create_join_request(user_id: string, bureau_id: string, input: OrganizationIdInput) {
    const organization_id = read_organization_id(input.organization_id);
    return await this.transaction(async (repository) => {
      const organization = await this.require_active_visible_organization(repository, organization_id, bureau_id);
      const membership = await repository.get_active_membership(organization_id, user_id);
      if (membership) return { state: "joined" as const, organization, membership };
      const pending = await repository.get_pending_join_request(organization_id, user_id);
      if (pending) return pending;
      const request: OrganizationJoinRequestRecord = {
        request_id: new_join_request_id(),
        organization_id,
        user_id,
        state: "pending",
        requested_at: new Date().toISOString(),
        decided_at: "",
        decided_by: "",
      };
      await repository.insert_join_request(request);
      return request;
    });
  }

  /** 用户取消自己的 pending Join Request。 */
  async cancel_join_request(user_id: string, bureau_id: string, input: OrganizationJoinRequestIdInput) {
    const request_id = read_request_id(input.request_id);
    return await this.transaction(async (repository) => {
      const request = await repository.get_join_request(request_id);
      if (!request || request.user_id !== user_id || request.state !== "pending") {
        throw httpError(404, "JOIN_REQUEST_NOT_FOUND");
      }
      await this.require_visible_organization(repository, request.organization_id, bureau_id);
      const decided_at = new Date().toISOString();
      await repository.update_join_request(request_id, {
        state: "canceled",
        decided_at,
        decided_by: user_id,
      });
      return { ...request, state: "canceled" as const, decided_at, decided_by: user_id };
    });
  }

  /** Owner/Admin 列出 pending Join Request。 */
  async list_join_requests(user_id: string, bureau_id: string, input: OrganizationIdInput) {
    const organization_id = read_organization_id(input.organization_id);
    await this.require_active_visible_organization(this.repo(), organization_id, bureau_id);
    require_role(await this.repo().get_active_membership(organization_id, user_id), ["owner", "admin"]);
    return await this.repo().list_pending_join_requests(organization_id);
  }

  /** Owner/Admin 批准或拒绝 Join Request。 */
  async decide_join_request(
    user_id: string,
    bureau_id: string,
    input: OrganizationJoinRequestDecisionInput,
  ) {
    const request_id = read_request_id(input.request_id);
    const decision = read_join_decision(input.decision);
    return await this.transaction(async (repository) => {
      const request = await repository.get_join_request(request_id);
      if (!request || request.state !== "pending") throw httpError(404, "JOIN_REQUEST_NOT_FOUND");
      await this.require_active_visible_organization(repository, request.organization_id, bureau_id);
      require_role(
        await repository.get_active_membership(request.organization_id, user_id),
        ["owner", "admin"],
      );
      const decided_at = new Date().toISOString();
      let membership: OrganizationMembershipRecord | undefined;
      if (decision === "approved") {
        membership = await repository.get_active_membership(request.organization_id, request.user_id);
        if (!membership) {
          membership = {
            membership_id: new_membership_id(),
            organization_id: request.organization_id,
            user_id: request.user_id,
            role: "member",
            state: "active",
            created_at: decided_at,
            updated_at: decided_at,
            removed_at: "",
            removed_by: "",
          };
          await repository.insert_membership(membership);
        }
      }
      await repository.update_join_request(request_id, {
        state: decision,
        decided_at,
        decided_by: user_id,
      });
      return {
        request: { ...request, state: decision, decided_at, decided_by: user_id },
        membership,
      };
    });
  }

  private async remove_membership(
    repository: OrganizationRepository,
    membership: OrganizationMembershipRecord,
    removed_by: string,
  ) {
    const removed_at = new Date().toISOString();
    await repository.update_membership(membership.membership_id, {
      state: "removed",
      removed_at,
      removed_by,
      updated_at: removed_at,
    });
    return { ...membership, state: "removed" as const, removed_at, removed_by, updated_at: removed_at };
  }

  private async reserve_owner_slot(
    repository: OrganizationRepository,
    user_id: string,
    organization_id: string,
    created_at: string,
  ): Promise<OrganizationOwnerSlotRecord> {
    return await this.create_owner_slot(repository, user_id, organization_id, created_at);
  }

  private async create_owner_slot(
    repository: OrganizationRepository,
    user_id: string,
    organization_id: string,
    created_at: string,
  ): Promise<OrganizationOwnerSlotRecord> {
    const used = new Set((await repository.list_owner_slots(user_id)).map((item) => item.slot));
    for (let slot = 1; slot <= this.max_organizations_per_user; slot += 1) {
      if (!used.has(slot)) return { user_id, slot, organization_id, created_at };
    }
    throw httpError(409, "ORGANIZATION_LIMIT_REACHED");
  }

  /**
   * PostgreSQL 并发命令可能同时选择同一空槽位；唯一约束裁决后重跑完整事务，
   * 让下一次读取选择剩余槽位或返回明确的额度错误。
   */
  private async with_owner_slot_retry<TResult>(handler: () => Promise<TResult>): Promise<TResult> {
    const max_attempts = this.max_organizations_per_user + 1;
    for (let attempt = 1; attempt <= max_attempts; attempt += 1) {
      try {
        return await handler();
      } catch (error) {
        if (!is_owner_slot_conflict(error) || attempt === max_attempts) throw error;
      }
    }
    throw new Error("OrganizationsService owner slot retry exhausted");
  }

  private async require_visible_organization(
    repository: OrganizationRepository,
    organization_id: string,
    bureau_id: string,
  ): Promise<OrganizationRecord> {
    const organization = await repository.require_organization(organization_id);
    if (!this.is_visible_in_bureau(organization, bureau_id)) {
      throw httpError(403, "ORGANIZATION_BUREAU_MISMATCH");
    }
    return organization;
  }

  private async require_active_visible_organization(
    repository: OrganizationRepository,
    organization_id: string,
    bureau_id: string,
  ): Promise<OrganizationRecord> {
    const organization = await this.require_visible_organization(repository, organization_id, bureau_id);
    if (organization.state !== "active") throw httpError(410, "ORGANIZATION_ARCHIVED");
    return organization;
  }

  /** 判断 Organization 是否对当前 Token Bureau 可见。 */
  private is_visible_in_bureau(organization: OrganizationRecord, bureau_id: string): boolean {
    return organization.scope_type === "federation" || organization.scope_bureau_id === bureau_id;
  }

  private async transaction<TResult>(
    handler: (repository: OrganizationRepository) => Promise<TResult>,
  ): Promise<TResult> {
    if (!this.transaction_runner) throw new Error("OrganizationsService transaction runtime is not ready");
    return await this.transaction_runner((context) => handler(new OrganizationRepository(context)));
  }

  private repo(): OrganizationRepository {
    if (!this.repository) throw new Error("OrganizationsService repository is not ready");
    return this.repository;
  }
}

/** 识别 PostgreSQL owner slot 唯一约束冲突，并沿 Driver cause 链读取错误。 */
function is_owner_slot_conflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const record = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };
    const constraint = String(record.constraint_name ?? record.constraint ?? "");
    if (record.code === "23505" && constraint.includes("service_organization_owner_slots")) {
      return true;
    }
    current = record.cause;
  }
  return false;
}
