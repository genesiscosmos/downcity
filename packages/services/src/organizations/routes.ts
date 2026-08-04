/** Organizations Service 的 HTTP Action 装配模块。 */

import type { ServiceInstallContext } from "@downcity/city";
import { require_service_user_identity } from "../shared/service-identity.js";
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
    handler: async (request) => {
      const identity = require_service_user_identity(request);
      return request.jsonResponse({
        items: await service.list_my(
          identity.user_id,
          identity.bureau_id,
          await request.json<OrganizationListMyInput>(),
        ),
      });
    },
  });

  context.route({
    method: "GET",
    path: "/get",
    auth: ["user"],
    handler: async (request) => {
      const identity = require_service_user_identity(request);
      return request.jsonResponse(await service.get_organization(
        identity.user_id, identity.bureau_id, await request.json<OrganizationIdInput>(),
      ));
    },
  });

  context.route({
    method: "POST",
    path: "/create",
    auth: ["user"],
    handler: async (request) => {
      const identity = require_service_user_identity(request);
      return request.jsonResponse(await service.create(
        identity.user_id, identity.bureau_id, await request.json<OrganizationCreateInput>(),
      ));
    },
  });

  context.route({
    method: "POST",
    path: "/update",
    auth: ["user"],
    handler: async (request) => {
      const identity = require_service_user_identity(request);
      return request.jsonResponse(await service.update(
        identity.user_id, identity.bureau_id, await request.json<OrganizationUpdateInput>(),
      ));
    },
  });

  context.route({
    method: "POST",
    path: "/archive",
    auth: ["user"],
    handler: async (request) => {
      const identity = require_service_user_identity(request);
      return request.jsonResponse(await service.archive(
        identity.user_id, identity.bureau_id, await request.json<OrganizationIdInput>(),
      ));
    },
  });

  context.route({
    method: "GET",
    path: "/membership/get",
    auth: ["user"],
    handler: async (request) => {
      const identity = require_service_user_identity(request);
      return request.jsonResponse(await service.get_membership(
        identity.user_id, identity.bureau_id, await request.json<OrganizationIdInput>(),
      ));
    },
  });

  context.route({
    method: "GET",
    path: "/members/list",
    auth: ["user"],
    handler: async (request) => {
      const identity = require_service_user_identity(request);
      return request.jsonResponse({ items: await service.list_members(
        identity.user_id, identity.bureau_id, await request.json<OrganizationIdInput>(),
      ) });
    },
  });

  context.route({
    method: "POST",
    path: "/members/role",
    auth: ["user"],
    handler: async (request) => {
      const identity = require_service_user_identity(request);
      return request.jsonResponse(await service.update_member_role(
        identity.user_id, identity.bureau_id, await request.json<OrganizationMemberRoleInput>(),
      ));
    },
  });

  context.route({
    method: "POST",
    path: "/members/remove",
    auth: ["user"],
    handler: async (request) => {
      const identity = require_service_user_identity(request);
      return request.jsonResponse(await service.remove_member(
        identity.user_id, identity.bureau_id, await request.json<OrganizationMemberRemoveInput>(),
      ));
    },
  });

  context.route({
    method: "POST",
    path: "/members/leave",
    auth: ["user"],
    handler: async (request) => {
      const identity = require_service_user_identity(request);
      return request.jsonResponse(await service.leave(
        identity.user_id, identity.bureau_id, await request.json<OrganizationIdInput>(),
      ));
    },
  });

  context.route({
    method: "POST",
    path: "/owner/transfer",
    auth: ["user"],
    handler: async (request) => {
      const identity = require_service_user_identity(request);
      return request.jsonResponse(await service.transfer_owner(
        identity.user_id, identity.bureau_id, await request.json<OrganizationOwnerTransferInput>(),
      ));
    },
  });

  context.route({
    method: "POST",
    path: "/join-requests/create",
    auth: ["user"],
    handler: async (request) => {
      const identity = require_service_user_identity(request);
      return request.jsonResponse(await service.create_join_request(
        identity.user_id, identity.bureau_id, await request.json<OrganizationIdInput>(),
      ));
    },
  });

  context.route({
    method: "POST",
    path: "/join-requests/cancel",
    auth: ["user"],
    handler: async (request) => {
      const identity = require_service_user_identity(request);
      return request.jsonResponse(await service.cancel_join_request(
        identity.user_id, identity.bureau_id, await request.json<OrganizationJoinRequestIdInput>(),
      ));
    },
  });

  context.route({
    method: "GET",
    path: "/join-requests/list",
    auth: ["user"],
    handler: async (request) => {
      const identity = require_service_user_identity(request);
      return request.jsonResponse({ items: await service.list_join_requests(
        identity.user_id, identity.bureau_id, await request.json<OrganizationIdInput>(),
      ) });
    },
  });

  context.route({
    method: "POST",
    path: "/join-requests/decide",
    auth: ["user"],
    handler: async (request) => {
      const identity = require_service_user_identity(request);
      return request.jsonResponse(await service.decide_join_request(
        identity.user_id,
        identity.bureau_id,
        await request.json<OrganizationJoinRequestDecisionInput>(),
      ));
    },
  });
}
