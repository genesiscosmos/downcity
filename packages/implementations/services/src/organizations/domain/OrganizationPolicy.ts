/** Organizations Service 的输入与权限策略。 */

import { httpError } from "@downcity/federation";
import type {
  OrganizationMembershipRecord,
  OrganizationRole,
  OrganizationScopeType,
} from "../types/index.js";

/** 读取并校验 Organization ID。 */
export function read_organization_id(value: unknown): string {
  const organization_id = read_required_text(value, "organization_id", 128);
  if (!/^org_[0-9A-HJKMNP-TV-Z]{26}$/u.test(organization_id)) {
    throw httpError(400, "ORGANIZATION_INPUT_INVALID: invalid organization_id");
  }
  return organization_id;
}

/** 读取并校验 Membership ID。 */
export function read_membership_id(value: unknown): string {
  const membership_id = read_required_text(value, "membership_id", 128);
  if (!/^mem_[0-9A-HJKMNP-TV-Z]{26}$/u.test(membership_id)) {
    throw httpError(400, "ORGANIZATION_INPUT_INVALID: invalid membership_id");
  }
  return membership_id;
}

/** 读取并校验 Join Request ID。 */
export function read_request_id(value: unknown): string {
  const request_id = read_required_text(value, "request_id", 128);
  if (!/^join_[0-9A-HJKMNP-TV-Z]{26}$/u.test(request_id)) {
    throw httpError(400, "ORGANIZATION_INPUT_INVALID: invalid request_id");
  }
  return request_id;
}

/** 读取 Organization 展示名称。 */
export function read_organization_name(value: unknown): string {
  return read_required_text(value, "name", 120);
}

/** 读取 Organization 作用域类型。 */
export function read_scope_type(value: unknown): OrganizationScopeType {
  if (value === "federation" || value === "bureau") return value;
  throw httpError(400, "ORGANIZATION_SCOPE_INVALID: scope_type must be federation or bureau");
}

/** 读取是否包含归档 Organization 的查询参数。 */
export function read_include_archived(value: unknown): boolean {
  if (value === undefined || value === false || value === "false") return false;
  if (value === true || value === "true") return true;
  throw httpError(400, "ORGANIZATION_INPUT_INVALID: include_archived must be true or false");
}

/** 读取 Join Request 决策。 */
export function read_join_decision(value: unknown): "approved" | "rejected" {
  if (value === "approved" || value === "rejected") return value;
  throw httpError(400, "ORGANIZATION_INPUT_INVALID: decision must be approved or rejected");
}

/** 读取可由 Owner 设置的非 Owner 角色。 */
export function read_assignable_role(value: unknown): "admin" | "member" {
  if (value === "admin" || value === "member") return value;
  throw httpError(400, "ORGANIZATION_INPUT_INVALID: role must be admin or member");
}

/** 要求 Membership 具有指定治理角色。 */
export function require_role(
  membership: OrganizationMembershipRecord | undefined,
  roles: OrganizationRole[],
): OrganizationMembershipRecord {
  if (!membership || membership.state !== "active") {
    throw httpError(403, "NOT_AN_ORGANIZATION_MEMBER");
  }
  if (!roles.includes(membership.role)) {
    throw httpError(403, "ORGANIZATION_ROLE_DENIED");
  }
  return membership;
}

/** 读取必填、已去除首尾空白的文本。 */
export function read_required_text(value: unknown, field: string, max_length: number): string {
  if (typeof value !== "string") {
    throw httpError(400, `ORGANIZATION_INPUT_INVALID: ${field} is required`);
  }
  const text = value.trim();
  if (!text || text.length > max_length) {
    throw httpError(400, `ORGANIZATION_INPUT_INVALID: ${field} must be 1-${max_length} characters`);
  }
  return text;
}
