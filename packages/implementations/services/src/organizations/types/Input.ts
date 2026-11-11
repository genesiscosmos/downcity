/** Organizations Service 的公开 Action 输入类型。 */

import type { OrganizationRole } from "./Membership.js";

/** 创建私有 Organization 的输入，默认关闭非成员申请。 */
export interface OrganizationCreateInput extends Record<string, unknown> {
  /** 面向用户展示的 Organization 名称。 */
  name: string;
  /** 新申请策略；省略时关闭，由 owner/admin 显式开放后才接受新申请。 */
  join_policy?: "closed" | "approval";
}

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
  /** 新的展示名称；省略时保留。 */
  name?: string;
  /** owner/admin 修改的新申请策略；省略时保留。 */
  join_policy?: "closed" | "approval";
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
