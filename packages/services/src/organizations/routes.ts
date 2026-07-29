/** Organizations Service 的 HTTP Action 装配模块。 */

import { httpError, type ServiceInstallContext, type ServiceRouteContext } from "@downcity/city";
import type { OrganizationsService } from "./service.js";
import type {
  OrganizationCreateInput,
  OrganizationIdInput,
  OrganizationJoinRequestDecisionInput,
  OrganizationJoinRequestIdInput,
  OrganizationMemberRemoveInput,
  OrganizationMemberRoleInput,
  OrganizationOwnerTransferInput,
  OrganizationServerUpdateInput,
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
      items: await service.list_my(read_user_id(request), read_city_id(request)),
    }),
  });

  context.route({
    method: "GET",
    path: "/get",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.get_organization(
      read_user_id(request), read_city_id(request), await request.json<OrganizationIdInput>(),
    )),
  });

  context.route({
    method: "POST",
    path: "/create",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.create(
      read_user_id(request), read_city_id(request), await request.json<OrganizationCreateInput>(),
    )),
  });

  context.route({
    method: "POST",
    path: "/update",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.update(
      read_user_id(request), read_city_id(request), await request.json<OrganizationUpdateInput>(),
    )),
  });

  context.route({
    method: "POST",
    path: "/server/update",
    auth: ["user"],
    handler: async (request) => {
      const result = await service.update_server(
        read_user_id(request), read_city_id(request), await request.json<OrganizationServerUpdateInput>(),
      );
      await schedule_event_delivery(service, request);
      return request.jsonResponse(result);
    },
  });

  context.route({
    method: "POST",
    path: "/archive",
    auth: ["user"],
    handler: async (request) => {
      const result = await service.archive(
        read_user_id(request), read_city_id(request), await request.json<OrganizationIdInput>(),
      );
      await schedule_event_delivery(service, request);
      return request.jsonResponse(result);
    },
  });

  context.route({
    method: "GET",
    path: "/membership/get",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.get_membership(
      read_user_id(request), read_city_id(request), await request.json<OrganizationIdInput>(),
    )),
  });

  context.route({
    method: "GET",
    path: "/members/list",
    auth: ["user"],
    handler: async (request) => request.jsonResponse({ items: await service.list_members(
      read_user_id(request), read_city_id(request), await request.json<OrganizationIdInput>(),
    ) }),
  });

  context.route({
    method: "POST",
    path: "/members/role",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.update_member_role(
      read_user_id(request), read_city_id(request), await request.json<OrganizationMemberRoleInput>(),
    )),
  });

  context.route({
    method: "POST",
    path: "/members/remove",
    auth: ["user"],
    handler: async (request) => {
      const result = await service.remove_member(
        read_user_id(request), read_city_id(request), await request.json<OrganizationMemberRemoveInput>(),
      );
      await schedule_event_delivery(service, request);
      return request.jsonResponse(result);
    },
  });

  context.route({
    method: "POST",
    path: "/members/leave",
    auth: ["user"],
    handler: async (request) => {
      const result = await service.leave(
        read_user_id(request), read_city_id(request), await request.json<OrganizationIdInput>(),
      );
      await schedule_event_delivery(service, request);
      return request.jsonResponse(result);
    },
  });

  context.route({
    method: "POST",
    path: "/owner/transfer",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.transfer_owner(
      read_user_id(request), read_city_id(request), await request.json<OrganizationOwnerTransferInput>(),
    )),
  });

  context.route({
    method: "POST",
    path: "/join-requests/create",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.create_join_request(
      read_user_id(request), read_city_id(request), await request.json<OrganizationIdInput>(),
    )),
  });

  context.route({
    method: "POST",
    path: "/join-requests/cancel",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.cancel_join_request(
      read_user_id(request), read_city_id(request), await request.json<OrganizationJoinRequestIdInput>(),
    )),
  });

  context.route({
    method: "GET",
    path: "/join-requests/list",
    auth: ["user"],
    handler: async (request) => request.jsonResponse({ items: await service.list_join_requests(
      read_user_id(request), read_city_id(request), await request.json<OrganizationIdInput>(),
    ) }),
  });

  context.route({
    method: "POST",
    path: "/join-requests/decide",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.decide_join_request(
      read_user_id(request), read_city_id(request), await request.json<OrganizationJoinRequestDecisionInput>(),
    )),
  });

  context.route({
    method: "POST",
    path: "/token/create",
    auth: ["user"],
    handler: async (request) => request.jsonResponse(await service.issue_token(
      read_user_id(request), read_city_id(request), await request.json<OrganizationIdInput>(),
    )),
  });

  context.route({
    method: "POST",
    path: "/events/deliver",
    auth: ["admin"],
    handler: async (request) => {
      const result = await service.deliver_pending_events();
      if (result.pending > 0) await schedule_retry(request);
      return request.jsonResponse(result);
    },
  });
}

/** 在当前请求生命周期外推进 Outbox；普通 Node 运行时会同步等待首次尝试。 */
async function schedule_event_delivery(
  service: OrganizationsService,
  request: ServiceRouteContext,
): Promise<void> {
  const delivery = service.deliver_pending_events().then(async (result) => {
    if (result.pending > 0) await schedule_retry(request);
  });
  if (request.waitUntil) {
    request.waitUntil(delivery);
    return;
  }
  await delivery;
}

/** 使用 Federation Queue 延迟重试；未配置 Adapter 时 Event 继续保留为 pending。 */
async function schedule_retry(request: ServiceRouteContext): Promise<void> {
  if (!request.queue) return;
  try {
    await request.queue.send({
      service: "organizations",
      action: "events/deliver",
      input: {},
      delay_ms: 5_000,
    });
  } catch {
    // Event 已持久化；Queue 未配置或暂时不可用时由后续请求/运维 Action 重放。
  }
}

/** 读取当前 user_token 用户 ID。 */
function read_user_id(request: ServiceRouteContext): string {
  const user_id = request.user?.user_id ?? "";
  if (!user_id) throw httpError(401, "AUTH_REQUIRED");
  return user_id;
}

/** 读取当前 user_token City ID。 */
function read_city_id(request: ServiceRouteContext): string {
  const city_id = request.city?.city_id ?? "";
  if (!city_id) throw httpError(401, "AUTH_REQUIRED");
  return city_id;
}
