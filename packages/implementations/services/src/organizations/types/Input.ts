/** Organizations Service 的公开 Action 输入类型。 */

import type { OrganizationRole } from "./Membership.js";

/** 创建 Federation 全局 Organization 的输入。 */
export interface FederationOrganizationCreateInput extends Record<string, unknown> {
  /** 面向用户展示的 Organization 名称。 */
  name: string;
  /** 明确声明 Federation 全局作用域。 */
  scope_type: "federation";
}

/** 创建当前 Bureau Organization 的输入。 */
export interface BureauOrganizationCreateInput extends Record<string, unknown> {
  /** 面向用户展示的 Organization 名称。 */
  name: string;
  /** 明确声明当前 Token Bureau 作用域。 */
  scope_type: "bureau";
}

/** 创建 Organization 的输入。 */
export type OrganizationCreateInput = FederationOrganizationCreateInput | BureauOrganizationCreateInput;

/** 列出当前用户 Organization 的输入。 */
export interface OrganizationListMyInput extends Record<string, unknown> {
  /** 是否包含已经归档的 Organization；默认不包含。 */
  include_archived?: boolean | "true" | "false";
}

/** 通过 Organization ID 定位资源的公共输入。 */
export interface OrganizationIdInput extends Record<string, unknown> {
  /** 目标 Organization ID。 */
  organization_id: string;
}

/** 更新 Organization 名称的输入。 */
export interface OrganizationUpdateInput extends OrganizationIdInput {
  /** 新的展示名称。 */
  name: string;
}

/** 更新 Membership 角色的输入。 */
export interface OrganizationMemberRoleInput extends OrganizationIdInput {
  /** 目标 Membership ID。 */
  membership_id: string;
  /** 新角色；公开 Action 只接受 admin 或 member。 */
  role: Extract<OrganizationRole, "admin" | "member">;
}

/** 移除 Membership 的输入。 */
export interface OrganizationMemberRemoveInput extends OrganizationIdInput {
  /** 目标 Membership ID。 */
  membership_id: string;
}

/** Owner 转移输入。 */
export interface OrganizationOwnerTransferInput extends OrganizationIdInput {
  /** 新 Owner 对应的 active Membership ID。 */
  membership_id: string;
}

/** Join Request 决策输入。 */
export interface OrganizationJoinRequestDecisionInput extends Record<string, unknown> {
  /** 目标 Join Request ID。 */
  request_id: string;
  /** Owner/Admin 的决策。 */
  decision: "approved" | "rejected";
}

/** Join Request ID 输入。 */
export interface OrganizationJoinRequestIdInput extends Record<string, unknown> {
  /** 目标 Join Request ID。 */
  request_id: string;
}
