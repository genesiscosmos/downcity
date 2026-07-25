/**
 * Chat Access Plugin Actions。
 *
 * 关键点（中文）
 * - Control API 通过 Chat Plugin Action 管理当前 Agent 的 Access Store。
 * - CLI 可以直接复用 ChatAccessService，不依赖运行中 Agent。
 */

import { create_action } from "@downcity/agent";
import type { PluginActions } from "@downcity/agent";
import type { JsonValue } from "@downcity/agent";
import { z } from "zod";
import { create_chat_access_service } from "@/chat/access/ChatAccessRuntime.js";
import { CHAT_ACCESS_ACTIONS } from "@/chat/types/ChatAccess.js";
import type { ChatAccessScopeInput } from "@/chat/types/ChatAccess.js";

const scope_schema = z.enum(["direct", "group", "all"]);

/** 创建 Chat Access Action 集合。 */
export function create_chat_access_actions(): PluginActions {
  return {
    [CHAT_ACCESS_ACTIONS.snapshot]: create_action({
      description: "Read Chat Access principals, grants, and requests for the current Agent.",
      input_schema: {
        zod: z.object({}).passthrough(),
        json_schema: { type: "object", properties: {}, additionalProperties: true },
      },
      execute: async ({ context }) => ({
        success: true,
        data: create_chat_access_service(context).snapshot() as unknown as JsonValue,
      }),
    }),
    [CHAT_ACCESS_ACTIONS.approve]: create_action({
      description: "Approve a pending Chat Access request.",
      input_schema: {
        zod: z.object({
          request_id: z.string().min(1),
          scope: scope_schema.optional(),
          operator: z.string().min(1),
        }),
        json_schema: {
          type: "object",
          required: ["request_id", "operator"],
          properties: {
            request_id: { type: "string" },
            scope: { type: "string", enum: ["direct", "group", "all"] },
            operator: { type: "string" },
          },
        },
      },
      execute: async ({ context, input }) => {
        const body = input as {
          request_id: string;
          scope?: ChatAccessScopeInput;
          operator: string;
        };
        return {
          success: true,
          data: create_chat_access_service(context).approve_request(body) as unknown as JsonValue,
        };
      },
    }),
    [CHAT_ACCESS_ACTIONS.deny]: create_action({
      description: "Deny a pending Chat Access request.",
      input_schema: {
        zod: z.object({
          request_id: z.string().min(1),
          scope: scope_schema.optional(),
          operator: z.string().min(1),
        }),
        json_schema: {
          type: "object",
          required: ["request_id", "operator"],
          properties: {
            request_id: { type: "string" },
            scope: { type: "string", enum: ["direct", "group", "all"] },
            operator: { type: "string" },
          },
        },
      },
      execute: async ({ context, input }) => {
        const body = input as {
          request_id: string;
          scope?: ChatAccessScopeInput;
          operator: string;
        };
        return {
          success: true,
          data: create_chat_access_service(context).deny_request(body) as unknown as JsonValue,
        };
      },
    }),
    [CHAT_ACCESS_ACTIONS.set]: create_action({
      description: "Set allow or deny for a known Chat Access principal.",
      input_schema: {
        zod: z.object({
          principal_id: z.string().min(1),
          scope: scope_schema,
          effect: z.enum(["allow", "deny"]),
          operator: z.string().min(1),
        }),
        json_schema: {
          type: "object",
          required: ["principal_id", "scope", "effect", "operator"],
          properties: {
            principal_id: { type: "string" },
            scope: { type: "string", enum: ["direct", "group", "all"] },
            effect: { type: "string", enum: ["allow", "deny"] },
            operator: { type: "string" },
          },
        },
      },
      execute: async ({ context, input }) => {
        const body = input as {
          principal_id: string;
          scope: ChatAccessScopeInput;
          effect: "allow" | "deny";
          operator: string;
        };
        return {
          success: true,
          data: create_chat_access_service(context).set_principal_effect(body) as unknown as JsonValue,
        };
      },
    }),
    [CHAT_ACCESS_ACTIONS.revoke]: create_action({
      description: "Revoke Chat Access grants for a known principal.",
      input_schema: {
        zod: z.object({
          principal_id: z.string().min(1),
          scope: scope_schema,
          operator: z.string().min(1),
        }),
        json_schema: {
          type: "object",
          required: ["principal_id", "scope", "operator"],
          properties: {
            principal_id: { type: "string" },
            scope: { type: "string", enum: ["direct", "group", "all"] },
            operator: { type: "string" },
          },
        },
      },
      execute: async ({ context, input }) => {
        const body = input as {
          principal_id: string;
          scope: ChatAccessScopeInput;
          operator: string;
        };
        return {
          success: true,
          data: {
            removed_count: create_chat_access_service(context).revoke_grant(body),
          },
        };
      },
    }),
  };
}
