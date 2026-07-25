/**
 * ContactPlugin：agent 点对点关系与分享插件。
 *
 * 关键点（中文）
 * - `link/approve` 建立可信 contact，支持 outbound/inbound/bidirectional 三种可达方向。
 * - 每个 contact 固定一条长期 chat history。
 * - `share` 分享文本、链接、文件和目录，并进入对方 inbox。
 */

import type { PluginContext } from "@downcity/agent";
import type { PluginRunContext } from "@downcity/agent";
import type { JsonValue } from "@downcity/agent";
import type { PluginActions } from "@downcity/agent";
import { BasePlugin } from "@downcity/agent";
import type {
  ContactApproveCommandPayload,
  ContactChatCommandPayload,
  ContactCheckCommandPayload,
  ContactLinkCommandPayload,
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
import type { ContactChatResponse } from "@/contact/types/ContactChat.js";
import type { AgentContact } from "@/contact/types/Contact.js";
import type { SaveContactInboxShareInput } from "@/contact/types/ContactShare.js";
import type { ContactPluginOptions } from "@/contact/types/ContactPluginOptions.js";
import {
  appendContactMessage,
  createStableContactId,
  findContact,
  findContactByInboundToken,
  normalizeContactEndpoint,
  readContactMessages,
  saveContact,
  touchContactSeen,
} from "./runtime/ContactStore.js";
import {
  createContactLinkCode,
  parseContactLinkCode,
} from "./runtime/LinkCode.js";
import {
  saveContactLinkRecord,
} from "./runtime/LinkStore.js";
import {
  createContactId,
  createContactToken,
  hashContactToken,
} from "./runtime/Token.js";
import {
  callContactApprove,
  callContactChat,
  callContactConfirm,
  callContactPing,
  callContactShare,
} from "./runtime/RemoteClient.js";
import { saveContactInboxShare } from "./runtime/InboxStore.js";
import { createShareInput } from "./runtime/ShareBundle.js";
import { buildContactPluginSystemText } from "./runtime/SystemProvider.js";
import { resolveContactSelfEndpoint } from "./runtime/EndpointResolver.js";
import {
  buildContactApproveNotes,
  buildContactLinkNotes,
  classifyContactEndpoint,
} from "./runtime/EndpointNotice.js";
import {
  approveContactLinkRequest,
  confirmContactLinkRequest,
} from "./runtime/LinkApproval.js";
import { buildContactApproveCallbackDecision } from "./runtime/ApproveCallback.js";
import { createContactActions } from "./Action.js";
import {
  readContactObject,
  readContactString,
} from "./runtime/ContactPayload.js";

async function resolveSelfEndpoint(
  context: PluginContext,
  options: ContactPluginOptions,
  endpointOverride?: string,
  effective_env?: Readonly<Record<string, string>>,
): Promise<string> {
  const explicit = String(endpointOverride || "").trim();
  if (explicit) return normalizeContactEndpoint(explicit);
  const env = {
    ...process.env,
    ...context.workspace_env,
    ...effective_env,
  };
  const runtimePort = Number(process.env.DC_CITY_PORT || env.DC_CITY_PORT || "");
  // 关键点（中文）：link code 必须写入当前 runtime 的真实监听端口，不能使用可能已经过期的配置端口。
  const port = Number.isFinite(runtimePort) && runtimePort > 0
    ? runtimePort
    : options.port;
  const runtimeHost = String(process.env.DC_CITY_HOST || env.DC_CITY_HOST || "").trim();
  return normalizeContactEndpoint(
    await resolveContactSelfEndpoint({
      host: runtimeHost || options.host,
      port,
      env,
    }),
  );
}

function hasRuntimePublicEndpointEnv(
  context: PluginContext,
  effective_env?: Readonly<Record<string, string>>,
): boolean {
  const env = {
    ...process.env,
    ...context.workspace_env,
    ...effective_env,
  };
  return Boolean(
    String(env.DOWNCITY_PUBLIC_URL || "").trim() ||
      String(env.DOWNCITY_PUBLIC_HOST || "").trim(),
  );
}

function getAgentName(context: PluginContext): string {
  return String(context.agent_id || "downcity-agent").trim() || "downcity-agent";
}

function requireOutboundContact(contact: AgentContact): {
  endpoint: string;
  token: string;
} {
  if (!contact.endpoint || !contact.outboundToken) {
    throw new Error(`Contact is inbound-only and cannot be called directly: ${contact.name}`);
  }
  return {
    endpoint: contact.endpoint,
    token: contact.outboundToken,
  };
}

/**
 * Contact plugin 类实现。
 */
export class ContactPlugin extends BasePlugin {
  /**
   * plugin 名称。
   */
  readonly name = "contact";

  /**
   * 当前 plugin action 定义表。
   */
  readonly actions: PluginActions;

  /**
   * 当前实例持有的显式配置。
   */
  public readonly options: ContactPluginOptions;

  constructor(options?: ContactPluginOptions) {
    super();
    this.options = options || {};
    this.actions = createContactActions({
      link: async (context, payload, run_context) =>
        (await this.link(context, payload, run_context)) as unknown as JsonValue,
      approve: async (context, payload, run_context) =>
        (await this.approve(context, payload, run_context)) as unknown as JsonValue,
      check: async (context, payload) =>
        (await this.check(context, payload)) as unknown as JsonValue,
      chat: async (context, payload) =>
        (await this.chat(context, payload)) as unknown as JsonValue,
      share: async (context, payload) =>
        (await this.share(context, payload)) as unknown as JsonValue,
      remotePing: (context, payload) => this.remotePing(context, payload),
      remoteApprove: (context, request) => this.remoteApprove(context, request),
      remoteConfirm: (context, request) => this.remoteConfirm(context, request),
      remoteShare: async (context, payload) =>
        (await this.remoteShare(context, payload)) as unknown as JsonValue,
    });
  }

  /**
   * contact system 文本。
   */
  system(): string {
    return buildContactPluginSystemText();
  }

  private async link(
    context: PluginContext,
    payload: ContactLinkCommandPayload,
    run_context?: PluginRunContext,
  ) {
    const now = Date.now();
    const ttlSeconds = Math.max(
      60,
      Number(payload.ttlSeconds || this.options.ttlSeconds || 600),
    );
    const linkId = createContactId("link");
    const secret = createContactToken();
    const endpoint = await resolveSelfEndpoint(
      context,
      this.options,
      payload.endpoint || this.options.endpoint,
      run_context?.workspace_env,
    );
    const agentName = getAgentName(context);

    await saveContactLinkRecord(context.workspace_path, {
      id: linkId,
      agentName,
      endpoint,
      secretHash: hashContactToken(secret),
      created_at: now,
      expires_at: now + ttlSeconds * 1000,
      usedAt: null,
    });

    const code = createContactLinkCode({
      version: 1,
      linkId,
      agentName,
      endpoint,
      secret,
      created_at: now,
      expires_at: now + ttlSeconds * 1000,
    });
    return {
      code,
      linkId,
      agentName,
      endpoint,
      endpointReachability: classifyContactEndpoint(endpoint),
      notes: buildContactLinkNotes({ endpoint }),
      expires_at: now + ttlSeconds * 1000,
    };
  }

  private async approve(
    context: PluginContext,
    payload: ContactApproveCommandPayload,
    run_context?: PluginRunContext,
  ) {
    const parsed = parseContactLinkCode(payload.code);
    // 关键点（中文）：approve 端不使用本机时钟预判过期，避免两台机器时钟不一致时把本来可用的 link 提前拦截。
    // 是否过期统一交给 link 持有方在远端按本地记录判断。

    const targetReachability = classifyContactEndpoint(parsed.endpoint);
    const shouldResolveRequesterEndpoint =
      payload.endpoint ||
      hasRuntimePublicEndpointEnv(context, run_context?.workspace_env) ||
      targetReachability === "loopback" ||
      targetReachability === "private";
    const requesterEndpointCandidate = shouldResolveRequesterEndpoint
      ? await resolveSelfEndpoint(
          context,
          this.options,
          payload.endpoint || this.options.endpoint,
          run_context?.workspace_env,
        )
      : undefined;
    const callbackDecision = buildContactApproveCallbackDecision({
      targetEndpoint: parsed.endpoint,
      requesterEndpoint: requesterEndpointCandidate,
    });
    const requesterEndpoint = callbackDecision.callbackOffered
      ? callbackDecision.endpoint
      : undefined;
    const tokenForRequester = requesterEndpoint ? createContactToken() : undefined;
    const approveNotes = buildContactApproveNotes({
      targetEndpoint: parsed.endpoint,
    });
    let response: ContactApproveLinkResponse;
    try {
      response = await callContactApprove<ContactApproveLinkResponse>({
        endpoint: parsed.endpoint,
        body: {
          linkId: parsed.linkId,
          secret: parsed.secret,
          agentName: getAgentName(context),
          callbackOffered: callbackDecision.callbackOffered,
          callbackReason: callbackDecision.reason,
          ...(requesterEndpoint ? { endpoint: requesterEndpoint } : {}),
          ...(tokenForRequester ? { tokenForRequester } : {}),
        } as unknown as JsonValue,
      });
    } catch (error) {
      throw new Error(`${String(error)}\n${approveNotes.join("\n")}`);
    }
    if (!response.success) throw new Error(response.error || "Contact approve failed");

    const name = String(payload.name || response.agentName || parsed.agentName).trim();
    const contact = await saveContact(context.workspace_path, {
      id: createStableContactId(name),
      name,
      endpoint: response.endpoint || parsed.endpoint,
      reachability: "outbound",
      status: "trusted",
      outboundToken: response.tokenForOwner,
      inboundTokenHash: tokenForRequester ? hashContactToken(tokenForRequester) : null,
      created_at: Date.now(),
      lastSeenAt: Date.now(),
    });
    let confirmed = false;
    let confirmError: string | undefined;
    if (requesterEndpoint && tokenForRequester) {
      try {
        const confirm = await callContactConfirm<ContactConfirmResponse>({
          endpoint: parsed.endpoint,
          body: {
            linkId: parsed.linkId,
            secret: parsed.secret,
            agentName: getAgentName(context),
            endpoint: requesterEndpoint,
            tokenForRequester,
          } as unknown as JsonValue,
        });
        confirmed = Boolean(confirm.success && confirm.confirmed);
        if (!confirmed && confirm.error) confirmError = confirm.error;
      } catch (error) {
        // 关键点（中文）：confirm 只决定是否升级双向；approve 已成功时仍保留 outbound contact。
        confirmError = String(error);
      }
    }
    const finalContact = confirmed
      ? await saveContact(context.workspace_path, {
          ...contact,
          reachability: "bidirectional",
          inboundTokenHash: tokenForRequester ? hashContactToken(tokenForRequester) : null,
          lastSeenAt: Date.now(),
        })
      : contact;
    const finalNotes = buildContactApproveNotes({
      targetEndpoint: parsed.endpoint,
      requesterEndpoint,
      callbackConfirmed: confirmed,
    });
    return {
      contact: finalContact,
      reachability: finalContact.reachability,
      targetEndpointReachability: classifyContactEndpoint(parsed.endpoint),
      callbackOffered: callbackDecision.callbackOffered,
      callbackConfirmed: confirmed,
      callbackReason: callbackDecision.reason,
      ...(requesterEndpoint ? { requesterEndpoint } : {}),
      ...(confirmError ? { confirmError } : {}),
      notes: finalNotes,
    };
  }

  private async check(context: PluginContext, payload: ContactCheckCommandPayload) {
    const startedAt = Date.now();
    const endpointInput = String(payload.endpoint || "").trim();
    const contact = endpointInput
      ? null
      : await findContact(context.workspace_path, String(payload.target || "").trim());
    const endpoint = endpointInput || contact?.endpoint || "";
    if (!endpoint) throw new Error("contact target or --to endpoint is required");
    if (contact && !contact.outboundToken) {
      throw new Error(`Contact is inbound-only and cannot be checked directly: ${contact.name}`);
    }

    try {
      const pong = await callContactPing<ContactPingResponse>({
        endpoint,
        token: contact?.outboundToken || undefined,
      });
      if (contact && pong.success) {
        await touchContactSeen(context.workspace_path, contact.id);
      }
      return {
        target: contact?.name || endpoint,
        endpoint: normalizeContactEndpoint(endpoint),
        reachable: Boolean(pong.success),
        authenticated: pong.authenticated,
        latencyMs: Date.now() - startedAt,
        agentName: pong.agentName,
        ...(pong.error ? { error: pong.error } : {}),
      };
    } catch (error) {
      return {
        target: contact?.name || endpoint,
        endpoint: normalizeContactEndpoint(endpoint),
        reachable: false,
        latencyMs: Date.now() - startedAt,
        error: String(error),
      };
    }
  }

  private async chat(context: PluginContext, payload: ContactChatCommandPayload) {
    const contact = await findContact(context.workspace_path, payload.to);
    if (!contact) throw new Error(`Contact not found: ${payload.to}`);
    const message = String(payload.message || "").trim();
    if (!message) {
      return {
        contact,
        messages: await readContactMessages(context.workspace_path, contact.id),
      };
    }

    await appendContactMessage(context.workspace_path, contact.id, {
      role: "local",
      text: message,
      created_at: Date.now(),
    });
    const outbound = requireOutboundContact(contact);
    const response = await callContactChat<ContactChatResponse>({
      endpoint: outbound.endpoint,
      token: outbound.token,
      body: {
        senderContactId: contact.id,
        message,
        created_at: Date.now(),
      } as unknown as JsonValue,
    });
    if (!response.success) throw new Error(response.error || "Contact chat failed");
    await appendContactMessage(context.workspace_path, contact.id, {
      role: "remote",
      text: response.reply,
      created_at: Date.now(),
    });
    return response;
  }

  private async share(context: PluginContext, payload: ContactShareCommandPayload) {
    const contact = await findContact(context.workspace_path, payload.to);
    if (!contact) throw new Error(`Contact not found: ${payload.to}`);
    const outbound = requireOutboundContact(contact);
    const share = await createShareInput({
      context,
      fromContactId: contact.id,
      fromAgentName: getAgentName(context),
      text: payload.text,
      links: payload.links,
      paths: payload.paths,
    });
    const response = await callContactShare<{ success: boolean; shareId?: string; error?: string }>({
      endpoint: outbound.endpoint,
      token: outbound.token,
      body: share as unknown as JsonValue,
    });
    if (!response.success) throw new Error(response.error || "Contact share failed");
    return {
      shareId: response.shareId || share.meta.id,
      to: contact.name,
      items: share.payload.items.map((item) => ({
        type: item.type,
        title: item.title,
      })),
    };
  }

  private async remotePing(
    context: PluginContext,
    payload: { token?: string },
  ): Promise<ContactPingResponse> {
    const token = String(payload.token || "").trim();
    if (!token) {
      return {
        success: true,
        agentName: getAgentName(context),
        plugin: "contact",
      };
    }
    const contact = await findContactByInboundToken(context.workspace_path, token);
    return {
      success: true,
      agentName: getAgentName(context),
      plugin: "contact",
      authenticated: Boolean(contact && contact.status === "trusted"),
    };
  }

  private async remoteApprove(
    context: PluginContext,
    request: ContactApproveLinkRequest,
  ): Promise<ContactApproveLinkResponse> {
    return await approveContactLinkRequest({
      project_root: context.workspace_path,
      ownerAgentName: getAgentName(context),
      ownerEndpoint: await resolveSelfEndpoint(context, this.options),
      request,
    });
  }

  private async remoteConfirm(
    context: PluginContext,
    request: ContactConfirmRequest,
  ): Promise<ContactConfirmResponse> {
    return await confirmContactLinkRequest({
      project_root: context.workspace_path,
      ownerAgentName: getAgentName(context),
      request,
      verifyCallback: async ({ endpoint, token }) => {
        const pong = await callContactPing<ContactPingResponse>({
          endpoint,
          token,
        });
        return Boolean(pong.success && pong.authenticated);
      },
    });
  }

  private async remoteShare(context: PluginContext, rawPayload: JsonValue) {
    const payload = readContactObject(rawPayload);
    const token = readContactString(payload, "token");
    const body = readContactObject(payload.body);
    const contact = await findContactByInboundToken(context.workspace_path, token);
    if (!contact || contact.status !== "trusted") {
      throw new Error("Invalid contact token");
    }
    const share = body as unknown as SaveContactInboxShareInput;
    const meta = {
      ...share.meta,
      fromContactId: contact.id,
      fromAgentName: contact.name,
      receivedAt: Date.now(),
      status: "pending" as const,
    };
    await saveContactInboxShare(context.workspace_path, {
      meta,
      payload: share.payload,
      files: Array.isArray(share.files) ? share.files : [],
    });
    return {
      success: true,
      shareId: meta.id,
    };
  }
}
