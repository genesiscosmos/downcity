/** Organizations Service 的 HTTP Action 装配模块。 */

import { httpError, type ServiceInstallContext, type ServiceRouteContext } from "@downcity/city";
import type { OrganizationsService } from "./service.js";
import type {
  OrganizationCreateInput,
  OrganizationIdInput,
  OrganizationJoinRequestDecisionInput,
  OrganizationJoinRequestIdInput,
  OrganizationListMyInput,
  OrganizationMemberRemoveInput,
  OrganizationMemberRoleInput,
  OrganizationOwnerTransferInput,
  OrganizationUpdateInput,
} from "./types/index.js";

/** 注册 Organizations Service 全部公开 Action。 */
export function register_organization_routes(
  service: OrganizationsService,
  context: ServiceInstallContext,
): void {
  context.route({
    method: "GET",
    path: "/my",
    auth: ["user"],
    handler: async (request) => request.jsonResponse({
      items: await service.list_my(
        read_user_id(request),
        read_bureau_id(request),
        await request.json<OrganizationListMyInput>(),
      ),
    }),
  });

  context.route({
    method: "GET",
    path: "/get",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.get_organization(
      read_user_id(request), read_bureau_id(request), await request.json<OrganizationIdInput>(),
    )),
  });

  context.route({
    method: "POST",
    path: "/create",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.create(
      read_user_id(request), read_bureau_id(request), await request.json<OrganizationCreateInput>(),
    )),
  });

  context.route({
    method: "POST",
    path: "/update",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.update(
      read_user_id(request), read_bureau_id(request), await request.json<OrganizationUpdateInput>(),
    )),
  });

  context.route({
    method: "POST",
    path: "/archive",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.archive(
      read_user_id(request), read_bureau_id(request), await request.json<OrganizationIdInput>(),
    )),
  });

  context.route({
    method: "GET",
    path: "/membership/get",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.get_membership(
      read_user_id(request), read_bureau_id(request), await request.json<OrganizationIdInput>(),
    )),
  });

  context.route({
    method: "GET",
    path: "/members/list",
    auth: ["user"],
    handler: async (request) => request.jsonResponse({ items: await service.list_members(
      read_user_id(request), read_bureau_id(request), await request.json<OrganizationIdInput>(),
    ) }),
  });

  context.route({
    method: "POST",
    path: "/members/role",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.update_member_role(
      read_user_id(request), read_bureau_id(request), await request.json<OrganizationMemberRoleInput>(),
    )),
  });

  context.route({
    method: "POST",
    path: "/members/remove",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.remove_member(
      read_user_id(request), read_bureau_id(request), await request.json<OrganizationMemberRemoveInput>(),
    )),
  });

  context.route({
    method: "POST",
    path: "/members/leave",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.leave(
      read_user_id(request), read_bureau_id(request), await request.json<OrganizationIdInput>(),
    )),
  });

  context.route({
    method: "POST",
    path: "/owner/transfer",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.transfer_owner(
      read_user_id(request), read_bureau_id(request), await request.json<OrganizationOwnerTransferInput>(),
    )),
  });

  context.route({
    method: "POST",
    path: "/join-requests/create",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.create_join_request(
      read_user_id(request), read_bureau_id(request), await request.json<OrganizationIdInput>(),
    )),
  });

  context.route({
    method: "POST",
    path: "/join-requests/cancel",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.cancel_join_request(
      read_user_id(request), read_bureau_id(request), await request.json<OrganizationJoinRequestIdInput>(),
    )),
  });

  context.route({
    method: "GET",
    path: "/join-requests/list",
    auth: ["user"],
    handler: async (request) => request.jsonResponse({ items: await service.list_join_requests(
      read_user_id(request), read_bureau_id(request), await request.json<OrganizationIdInput>(),
    ) }),
  });

  context.route({
    method: "POST",
    path: "/join-requests/decide",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.decide_join_request(
      read_user_id(request), read_bureau_id(request), await request.json<OrganizationJoinRequestDecisionInput>(),
    )),
  });

}

/** 读取当前 user_token 用户 ID。 */
function read_user_id(request: ServiceRouteContext): string {
  const user_id = request.user?.user_id ?? "";
  if (!user_id) throw httpError(401, "AUTH_REQUIRED");
  return user_id;
}

/** 读取当前 user_token Bureau ID。 */
function read_bureau_id(request: ServiceRouteContext): string {
  const bureau_id = request.bureau?.bureau_id ?? "";
  if (!bureau_id) throw httpError(401, "AUTH_REQUIRED");
  return bureau_id;
}
