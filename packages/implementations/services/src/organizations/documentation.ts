/** Organizations API 文档；组织角色权限、终态和联合响应均按领域实现声明。 */
import type { ApiDocumentation, ApiSchema } from "@downcity/downtown";
import { object_schema as obj, items_schema, text_schema as text, enum_schema, time_schema } from "../shared/documentation.js";

const organization_id = { type: "string", pattern: "^org_[0-9A-HJKMNP-TV-Z]{26}$" };
const membership_id = { type: "string", pattern: "^mem_[0-9A-HJKMNP-TV-Z]{26}$" };
const request_id = { type: "string", pattern: "^join_[0-9A-HJKMNP-TV-Z]{26}$" };
const name = { type: "string", minLength: 1, maxLength: 120 };
const join_policy = enum_schema("closed", "approval");
const role = enum_schema("owner", "admin", "member");
const organization = obj({ organization_id, name, join_policy, state: enum_schema("active", "archived"), created_by: text("Creator user ID"), created_at: time_schema, updated_at: time_schema, archived_at: time_schema });
const membership = obj({ membership_id, organization_id, user_id: text("Member user ID"), role, state: enum_schema("active", "removed"), created_at: time_schema, updated_at: time_schema, removed_at: time_schema, removed_by: text("Removing user ID; empty while active") });
const join_request = obj({ request_id, organization_id, user_id: text("Applicant"), state: enum_schema("pending", "approved", "rejected", "canceled"), requested_at: time_schema, decided_at: time_schema, decided_by: text("Deciding user ID; empty while pending") });
const pair = obj({ organization, membership });
const org_input = obj({ organization_id });
const target_input = obj({ organization_id, membership_id });
const org_example = "org_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const member_example = "mem_01ARZ3NDEKTSV4RRFFQ69G5FAW";
const join_example = "join_01ARZ3NDEKTSV4RRFFQ69G5FAX";
const input_error = { status: 400, description: "Malformed ID, name, policy, role or decision" };
const user_error = { status: 401, description: "A valid user credential is required" };
const member_errors = [input_error, user_error, { status: 403, description: "No active membership or insufficient organization role" }, { status: 404, description: "Organization or referenced membership/request not found" }];
const active_errors = [...member_errors, { status: 410, description: "Organization is archived" }];

/** 共享同一组织权限和返回协议的入口，仍由调用点显式给出用途与示例。 */
function document(description: string, request_schema: ApiSchema, response_schema: ApiSchema, request: unknown, errors = active_errors): ApiDocumentation {
  return { description, request_schema, response_schema, errors, examples: [{ name: "Example request", request }] };
}

/** 完整的 Organizations Action 注册文档。 */
export const organization_documentation: Record<string, ApiDocumentation> = {
  "/my": document("List organizations where the caller has active membership, oldest first. Archived organizations are excluded unless include_archived is true.", obj({ include_archived: { anyOf: [{ type: "boolean" }, enum_schema("true", "false")] } }, []), items_schema({ allOf: [organization, obj({ role, membership_id, membership_state: enum_schema("active", "removed") })] }), { include_archived: false }, [input_error, user_error]),
  "/get": document("Read a private organization and the caller's active membership; archived organizations remain readable to active members.", org_input, pair, { organization_id: org_example }, member_errors),
  "/create": document("Create an organization and its owner membership atomically. join_policy defaults to closed. Consumes a configured owner quota slot.", obj({ name, join_policy }, ["name"]), pair, { name: "Example team", join_policy: "closed" }, [input_error, user_error, { status: 409, description: "Owner quota exceeded or concurrent slot allocation conflict" }]),
  "/update": document("Owner/admin: update name or join policy; omitted fields are retained.", obj({ organization_id, name, join_policy }, ["organization_id"]), organization, { organization_id: org_example, join_policy: "approval" }),
  "/archive": document("Owner only: permanently archive the organization and release the owner quota slot. This is an irreversible terminal state.", org_input, organization, { organization_id: org_example }),
  "/membership/get": document("Read the caller's organization and active membership, including archived organizations.", org_input, pair, { organization_id: org_example }, member_errors),
  "/members/list": document("Active members may list all active memberships in an active organization.", org_input, items_schema(membership), { organization_id: org_example }),
  "/members/role": document("Owner only: assign admin or member role to an active non-owner membership.", obj({ organization_id, membership_id, role: enum_schema("admin", "member") }), membership, { organization_id: org_example, membership_id: member_example, role: "admin" }, [...active_errors, { status: 409, description: "Owner role requires ownership transfer" }]),
  "/members/remove": document("Owner can remove non-owners; admin can remove members only. Marks the target membership removed.", target_input, membership, { organization_id: org_example, membership_id: member_example }, [...active_errors, { status: 409, description: "Owner must transfer ownership before removal" }]),
  "/members/leave": document("Member/admin: leave an active organization. Owner must transfer ownership first.", org_input, membership, { organization_id: org_example }, [...active_errors, { status: 409, description: "Owner must transfer ownership before leaving" }]),
  "/owner/transfer": document("Owner only: transfer ownership to an active member atomically. Previous owner becomes admin; target owner's quota is checked.", target_input, obj({ previous_owner: membership, owner: membership }), { organization_id: org_example, membership_id: member_example }, [...active_errors, { status: 409, description: "Target owner quota exceeded or concurrent quota conflict" }]),
  "/join-requests/create": document("Request to join an active organization with approval policy. Returns an existing pending request, or state=joined with membership when already a member.", org_input, { anyOf: [join_request, obj({ state: { const: "joined" }, organization, membership })] }, { organization_id: org_example }, [...active_errors, { status: 403, description: "Organization does not accept new applications" }]),
  "/join-requests/cancel": document("Applicant only: cancel own pending request. Cancellation is allowed even after organization archival.", obj({ request_id }), join_request, { request_id: join_example }, [input_error, user_error, { status: 404, description: "Own pending request or organization not found" }]),
  "/join-requests/list": document("Owner/admin: list pending join requests for an active organization.", org_input, items_schema(join_request), { organization_id: org_example }),
  "/join-requests/decide": document("Owner/admin: approve or reject a pending request. Approval creates or reuses an active membership; rejection omits membership from the response.", obj({ request_id, decision: enum_schema("approved", "rejected") }), obj({ request: join_request, membership }, ["request"]), { request_id: join_example, decision: "approved" }),
};
