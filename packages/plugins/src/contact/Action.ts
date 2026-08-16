/**
 * contact action 注册表。
 *
 * 关键点（中文）
 * - 这里只负责 CLI action 与内部远端 command action 映射，不承载 contact 业务实现。
 * - 业务动作通过 handlers 注入，保持 `ContactPlugin` 类本身更薄。
 */

import type { PluginContext } from "@downcity/agent";
import type { JsonObject, JsonValue } from "@downcity/agent";
import type { PluginActions } from "@downcity/agent";
import type { PluginExecutionContext } from "@downcity/agent";
import { create_action } from "@downcity/agent";
import { z } from "zod";
import type {
  ContactApproveCommandPayload,
  ContactChatCommandPayload,
  ContactCheckCommandPayload,
  ContactLinkCommandPayload,
  ContactReceiveCommandPayload,
  ContactShareCommandPayload,
} from "@/contact/types/ContactCommand.js";
import type {
  ContactApproveLinkRequest,
  ContactApproveLinkResponse,
} from "@/contact/types/ContactLink.js";
import type {
  ContactConfirmRequest,
  ContactConfirmResponse,
} from "@/contact/types/ContactApproval.js";
import type { ContactPingResponse } from "@/contact/types/ContactCheck.js";
import { listContacts } from "./runtime/ContactStore.js";
import { receiveContactChatMessage } from "./runtime/ChatRuntime.js";
import { listContactInboxShares } from "./runtime/InboxStore.js";
import { receiveShare } from "./runtime/ShareBundle.js";
import {
  readContactObject,
  readContactString,
} from "./runtime/ContactPayload.js";

/**
 * ContactPlugin 注入给 action 注册表的业务动作。
 */
export type ContactActionHandlers = {
  /**
   * 生成一次性联系码。
   */
  link: (
    context: PluginContext,
    payload: ContactLinkCommandPayload,
    execution_context?: PluginExecutionContext,
  ) => Promise<JsonValue>;
  /**
   * 使用联系码建立 contact。
   */
  approve: (
    context: PluginContext,
    payload: ContactApproveCommandPayload,
    execution_context?: PluginExecutionContext,
  ) => Promise<JsonValue>;
  /**
   * 检查 contact 或 endpoint 可用性。
   */
  check: (context: PluginContext, payload: ContactCheckCommandPayload) => Promise<JsonValue>;
  /**
   * 与 contact 对话或读取对话历史。
   */
  chat: (context: PluginContext, payload: ContactChatCommandPayload) => Promise<JsonValue>;
  /**
   * 向 contact 分享内容。
   */
  share: (context: PluginContext, payload: ContactShareCommandPayload) => Promise<JsonValue>;
  /**
   * 处理远端 ping 请求。
   */
  remotePing: (
    context: PluginContext,
    payload: { token?: string },
  ) => Promise<ContactPingResponse>;
  /**
   * 处理远端 approve 请求。
   */
  remoteApprove: (
    context: PluginContext,
    request: ContactApproveLinkRequest,
  ) => Promise<ContactApproveLinkResponse>;
  /**
   * 处理远端 confirm 请求。
   */
  remoteConfirm: (
    context: PluginContext,
    request: ContactConfirmRequest,
  ) => Promise<ContactConfirmResponse>;
  /**
   * 处理远端 share 请求。
   */
  remoteShare: (context: PluginContext, rawPayload: JsonValue) => Promise<JsonValue>;
};

/**
 * 创建 contact plugin action 表。
 */
export function createContactActions(handlers: ContactActionHandlers): PluginActions {
  return {
    link: create_action({
      description: "Create a one-time contact link code for another agent to approve.",
      input_schema: {
        zod: z.object({ ttlSeconds: z.number().optional() }),
        json_schema: {
          type: "object",
          properties: {
            ttlSeconds: { type: "number", description: "Link expiration in seconds, defaulting to 600." },
          },
        },
      },
      examples: [{ title: "Create default link", payload: {} }],
      command: {
        description: "Create a one-time contact link code for another agent to approve.",
        configure(command) {
          command.option("--ttl-seconds <seconds>", "Link expiration in seconds, defaulting to 600.", Number);
        },
        map_input({ opts }) {
          const payload: JsonObject = {};
          if (typeof opts.ttlSeconds === "number") payload.ttlSeconds = opts.ttlSeconds;
          return payload;
        },
      },
      execute: async (params) => ({
        success: true,
        data: await handlers.link(
          params.context,
          params.input as ContactLinkCommandPayload,
          params.execution_context,
        ),
      }),
    }),
    approve: create_action({
      description: "Use a contact link code to establish a peer-to-peer contact.",
      input_schema: {
        zod: z.object({
          code: z.string(),
          name: z.string().optional(),
        }),
        json_schema: {
          type: "object",
          required: ["code"],
          properties: {
            code: { type: "string", description: "link code" },
            name: { type: "string", description: "Local contact alias." },
          },
        },
      },
      examples: [
        { title: "approve link", payload: { code: "abc123", name: "alice" } },
      ],
      command: {
        description: "Use a contact link code to establish a peer-to-peer contact.",
        configure(command) {
          command
            .argument("<code>")
            .option("--name <alias>", "Local contact alias.");
        },
        map_input({ args, opts }) {
          const code = String(args[0] || "").trim();
          if (!code) throw new Error("Missing link code");
          const payload: JsonObject = { code };
          if (typeof opts.name === "string") payload.name = opts.name;
          return payload;
        },
      },
      execute: async (params) => ({
        success: true,
        data: await handlers.approve(
          params.context,
          params.input as unknown as ContactApproveCommandPayload,
          params.execution_context,
        ),
      }),
    }),
    list: create_action({
      description: "List established contacts.",
      input_schema: {
        zod: z.object({}).passthrough(),
        json_schema: { type: "object", properties: {} },
      },
      examples: [{ title: "List contacts", payload: {} }],
      command: {
        description: "List established contacts.",
        map_input() {
          return {};
        },
      },
      execute: async (params) => ({
        success: true,
        data: {
          contacts: await listContacts(params.context.data_path),
        } as unknown as JsonValue,
      }),
    }),
    check: create_action({
      description: "Check whether a contact or endpoint is currently online and reachable.",
      input_schema: {
        zod: z.object({
          target: z.string().optional(),
          endpoint: z.string().optional(),
        }),
        json_schema: {
          type: "object",
          properties: {
            target: { type: "string", description: "Saved contact name." },
            endpoint: { type: "string", description: "Endpoint to check directly." },
          },
        },
      },
      examples: [
        { title: "Check contact", payload: { target: "alice" } },
        { title: "Check endpoint", payload: { endpoint: "https://example.com" } },
      ],
      command: {
        description: "Check whether a contact or endpoint is currently online and reachable.",
        configure(command) {
          command
            .argument("[target]")
            .option("--to <endpoint>", "Directly check an unsaved endpoint.");
        },
        map_input({ args, opts }) {
          const payload: JsonObject = {};
          const target = String(args[0] || "").trim();
          if (target) payload.target = target;
          if (typeof opts.to === "string") payload.endpoint = opts.to;
          return payload;
        },
      },
      execute: async (params) => ({
        success: true,
        data: await handlers.check(
          params.context,
          params.input as ContactCheckCommandPayload,
        ),
      }),
    }),
    chat: create_action({
      description: "Chat with a contact in its long-lived conversation thread, or read conversation history.",
      input_schema: {
        zod: z.object({
          to: z.string(),
          message: z.string().optional(),
        }),
        json_schema: {
          type: "object",
          required: ["to"],
          properties: {
            to: { type: "string", description: "Target contact." },
            message: { type: "string", description: "Message to send." },
          },
        },
      },
      examples: [
        { title: "Send message", payload: { to: "alice", message: "hello" } },
        { title: "Read history", payload: { to: "alice" } },
      ],
      command: {
        description: "Chat with a contact in its long-lived conversation thread.",
        configure(command) {
          command.requiredOption("--to <contact>", "Target contact.").argument("[message...]");
        },
        map_input({ args, opts }) {
          const payload: JsonObject = {
            to: String(opts.to || "").trim(),
          };
          const message = args.join(" ").trim();
          if (message) payload.message = message;
          return payload;
        },
      },
      execute: async (params) => ({
        success: true,
        data: await handlers.chat(
          params.context,
          params.input as unknown as ContactChatCommandPayload,
        ),
      }),
    }),
    share: create_action({
      description: "Share text, links, files, or directories with a contact.",
      input_schema: {
        zod: z.object({
          to: z.string(),
          text: z.string().optional(),
          links: z.array(z.string()).optional(),
          paths: z.array(z.string()).optional(),
        }),
        json_schema: {
          type: "object",
          required: ["to"],
          properties: {
            to: { type: "string", description: "Target contact." },
            text: { type: "string", description: "Text to share." },
            links: { type: "array", items: { type: "string" }, description: "Links to share." },
            paths: { type: "array", items: { type: "string" }, description: "File or directory paths to share." },
          },
        },
      },
      examples: [
        {
          title: "Share text",
          payload: { to: "alice", text: "看看这个" },
        },
      ],
      command: {
        description: "Share text, links, files, or directories with a contact.",
        configure(command) {
          command
            .requiredOption("--to <contact>", "Target contact.")
            .option("--text <text>", "Text to share.")
            .option("--link <url...>", "Links to share.")
            .argument("[paths...]");
        },
        map_input({ args, opts }) {
          const links = Array.isArray(opts.link)
            ? opts.link.map((item) => String(item || "").trim()).filter(Boolean)
            : typeof opts.link === "string"
              ? [opts.link]
              : [];
          return {
            to: String(opts.to || "").trim(),
            ...(typeof opts.text === "string" ? { text: opts.text } : {}),
            ...(links.length > 0 ? { links } : {}),
            paths: args.map((item) => String(item || "").trim()).filter(Boolean),
          };
        },
      },
      execute: async (params) => ({
        success: true,
        data: await handlers.share(
          params.context,
          params.input as unknown as ContactShareCommandPayload,
        ),
      }),
    }),
    inbox: create_action({
      description: "View the contact inbox.",
      input_schema: {
        zod: z.object({}).passthrough(),
        json_schema: { type: "object", properties: {} },
      },
      examples: [{ title: "View inbox", payload: {} }],
      command: {
        description: "View the contact inbox.",
        map_input() {
          return {};
        },
      },
      execute: async (params) => ({
        success: true,
        data: {
          shares: await listContactInboxShares(params.context.data_path),
        } as unknown as JsonValue,
      }),
    }),
    receive: create_action({
      description: "Receive a share from the inbox.",
      input_schema: {
        zod: z.object({ shareId: z.string() }),
        json_schema: {
          type: "object",
          required: ["shareId"],
          properties: {
            shareId: { type: "string", description: "Share ID from the inbox." },
          },
        },
      },
      examples: [{ title: "Receive share", payload: { shareId: "share_1" } }],
      command: {
        description: "Receive a share from the inbox.",
        configure(command) {
          command.argument("<shareId>");
        },
        map_input({ args }) {
          const shareId = String(args[0] || "").trim();
          if (!shareId) throw new Error("Missing shareId");
          return { shareId };
        },
      },
      execute: async (params) => ({
        success: true,
        data: (await receiveShare({
          data_path: params.context.data_path,
          shareId: (params.input as unknown as ContactReceiveCommandPayload).shareId,
        })) as unknown as JsonValue,
      }),
    }),
    remoteping: create_action({
      description: "Handle a remote ping request (internal endpoint).",
      execute: async (params) => ({
        success: true,
        data: (await handlers.remotePing(
          params.context,
          params.input as unknown as { token?: string },
        )) as unknown as JsonValue,
      }),
    }),
    remoteapprove: create_action({
      description: "Handle a remote approve request (internal endpoint).",
      execute: async (params) => ({
        success: true,
        data: (await handlers.remoteApprove(
          params.context,
          readContactObject(params.input) as unknown as ContactApproveLinkRequest,
        )) as unknown as JsonValue,
      }),
    }),
    remoteconfirm: create_action({
      description: "Handle a remote confirm request (internal endpoint).",
      execute: async (params) => ({
        success: true,
        data: (await handlers.remoteConfirm(
          params.context,
          readContactObject(params.input) as unknown as ContactConfirmRequest,
        )) as unknown as JsonValue,
      }),
    }),
    remotechat: create_action({
      description: "Handle a remote chat request (internal endpoint).",
      execute: async (params) => {
        const payload = readContactObject(params.input);
        const body = readContactObject(payload.body);
        return {
          success: true,
          data: (await receiveContactChatMessage({
            context: params.context,
            token: readContactString(payload, "token"),
            message: readContactString(body, "message"),
          })) as unknown as JsonValue,
        };
      },
    }),
    remoteshare: create_action({
      description: "Handle a remote share request (internal endpoint).",
      execute: async (params) => ({
        success: true,
        data: (await handlers.remoteShare(params.context, params.input)) as unknown as JsonValue,
      }),
    }),
  };
}
