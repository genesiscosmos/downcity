/**
 * 飞书「扫码一键创建应用」注册会话服务。
 *
 * 关键点（中文）
 * - 基于 OAuth 2.0 Device Authorization Grant（RFC 8628），用户扫码后平台直接返回 App ID 与 App Secret。
 * - 一个注册会话只存在于当前 Power 进程内存中，不落盘；进程重启后必须重新扫码。
 * - 注册成功只产出凭据，不直接创建 Account；Account 仍走既有的 `accounts.create` 校验与启动链路。
 * - 同一时间只保留一个待完成会话，避免上一次轮询在后台长期空转。
 */

import { generate_id } from "@downcity/agent";
import { render_qr_code_data_url } from "@/chat/accounts/QrCodeDataUrl.js";
import { loadFeishuSdk } from "@/chat/channels/feishu/FeishuSdk.js";
import type {
  FeishuSdkAppAddons,
  FeishuSdkQrCodeInfo,
  FeishuSdkRegisterAppResult,
  FeishuSdkRegistrationUserInfo,
} from "@/chat/channels/feishu/types/FeishuSdk.js";
import type {
  FeishuAppRegistrationState,
  FeishuAppRegistrationView,
} from "@/chat/types/FeishuAppRegistration.js";

/** 注册会话 ID 前缀。 */
const REGISTRATION_ID_PREFIX = "feishu_app_registration";

/** 会话进入终态后继续保留视图的时间，便于 Renderer 读取最终状态。 */
const VIEW_RETENTION_MS = 5 * 60 * 1000;

/** 扫码创建应用的来源标识。 */
const REGISTRATION_SOURCE = "downcity";

/** Lark 租户使用的 Open API 域名。 */
const LARK_OPEN_API_DOMAIN = "https://open.larksuite.com";

/** 创建应用时预填的名称。 */
const APP_PRESET_NAME = "{user} 的 Downcity 助手";

/** 创建应用时预填的描述。 */
const APP_PRESET_DESC = "由 Downcity 扫码创建，用于把飞书会话接入本地 Agent。";

/** 叠加在平台基础模板之上的权限点、事件与回调。 */
const APP_ADDONS: FeishuSdkAppAddons = {
  scopes: {
    tenant: [
      "im:message.p2p_msg:readonly",
      "im:message.group_at_msg:readonly",
      "im:message:send_as_bot",
      "im:resource",
      "im:message.reaction:write",
    ],
  },
  events: { items: { tenant: ["im.message.receive_v1"] } },
};

/** 一个注册会话的内部状态。 */
interface RegistrationEntry {
  /** 本次注册会话的稳定 ID。 */
  registration_id: string;
  /** 用于取消 SDK 轮询的中断控制器。 */
  controller: AbortController;
  /** 当前会话状态。 */
  state: FeishuAppRegistrationState;
  /** 用户扫码或直接打开的验证链接。 */
  verification_url: string;
  /** 二维码图片 data URL。 */
  qr_data_url: string;
  /** 会话过期时间戳，单位毫秒；二维码就绪前为 0。 */
  expires_at: number;
  /** 终态下用户可见的原因。 */
  error?: string;
  /** 注册成功后的 App ID。 */
  app_id?: string;
  /** 注册成功后的 App Secret。 */
  app_secret?: string;
  /** 注册成功后推导出的 Open API 域名。 */
  domain?: string;
  /** 终态后清理视图的定时器。 */
  cleanup_timer?: NodeJS.Timeout;
}

/** 一个尚未落定的 Promise 及其控制器。 */
interface Deferred<TValue> {
  /** 待落定的 Promise。 */
  promise: Promise<TValue>;
  /** 以成功状态落定。 */
  resolve: (value: TValue) => void;
  /** 以失败状态落定。 */
  reject: (error: unknown) => void;
}

/** 创建一个可外部落定的 Promise。 */
function create_deferred<TValue>(): Deferred<TValue> {
  let resolve!: (value: TValue) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<TValue>((resolve_value, reject_value) => {
    resolve = resolve_value;
    reject = reject_value;
  });
  return { promise, resolve, reject };
}

/** 把 SDK 抛出的错误转成用户可读文本。 */
function describe_registration_error(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  if (code === "access_denied") return "你在飞书中取消了授权";
  if (code === "expired_token") return "二维码已过期，请重新生成";
  if (code === "abort") return "注册已取消";
  const description = error && typeof error === "object" && "description" in error
    ? String((error as { description?: unknown }).description || "")
    : "";
  if (description) return description;
  return error instanceof Error ? error.message : String(error);
}

/** 根据扫码用户所属租户推导 Open API 域名。 */
function resolve_open_api_domain(user_info?: FeishuSdkRegistrationUserInfo): string | undefined {
  return user_info?.tenant_brand === "lark" ? LARK_OPEN_API_DOMAIN : undefined;
}

/** 把内部状态投影成 Desktop 可读视图。 */
function to_view(entry: RegistrationEntry): FeishuAppRegistrationView {
  return {
    registration_id: entry.registration_id,
    state: entry.state,
    verification_url: entry.verification_url,
    qr_data_url: entry.qr_data_url,
    expires_at: entry.expires_at,
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.app_id ? { app_id: entry.app_id } : {}),
    ...(entry.app_secret ? { app_secret: entry.app_secret } : {}),
    ...(entry.domain ? { domain: entry.domain } : {}),
  };
}

/**
 * 管理飞书扫码创建应用的注册会话。
 *
 * 使用方按 `begin` → 轮询 `read` → `cancel` 或 `dispose` 的顺序驱动。
 */
export class FeishuAppRegistrationService {
  /** 当前进程内仍然可读的全部注册会话。 */
  private readonly registrations = new Map<string, RegistrationEntry>();

  /**
   * 开始一次注册，返回带二维码的会话视图。
   *
   * 会先取消上一个尚未完成的会话，保证同一时间只有一个轮询在运行。
   */
  async begin(): Promise<FeishuAppRegistrationView> {
    this.cancel_pending_registrations();
    const sdk = loadFeishuSdk();
    const register_app = sdk.registerApp;
    if (typeof register_app !== "function") {
      throw new Error(
        "当前 @larksuiteoapi/node-sdk 不支持扫码创建应用，请升级到 ^1.67.0 后重试，"
          + "或在高级设置中手动填写 App ID 与 App Secret。",
      );
    }

    const controller = new AbortController();
    const qr_ready = create_deferred<FeishuSdkQrCodeInfo>();
    const registration_id = `${REGISTRATION_ID_PREFIX}_${generate_id()}`;
    const entry: RegistrationEntry = {
      registration_id,
      controller,
      state: "pending",
      verification_url: "",
      qr_data_url: "",
      expires_at: 0,
    };
    this.registrations.set(registration_id, entry);

    void register_app({
      source: REGISTRATION_SOURCE,
      signal: controller.signal,
      createOnly: true,
      appPreset: { name: APP_PRESET_NAME, desc: APP_PRESET_DESC },
      addons: APP_ADDONS,
      onQRCodeReady: (info) => qr_ready.resolve(info),
    })
      .then((result: FeishuSdkRegisterAppResult) => {
        entry.state = "ready";
        entry.app_id = result.client_id;
        entry.app_secret = result.client_secret;
        const domain = resolve_open_api_domain(result.user_info);
        if (domain) entry.domain = domain;
        this.schedule_cleanup(entry);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          entry.state = "cancelled";
          entry.error = "注册已取消";
        } else {
          entry.state = "failed";
          entry.error = describe_registration_error(error);
        }
        this.schedule_cleanup(entry);
        qr_ready.reject(error);
      });

    const qr_info = await qr_ready.promise;
    entry.verification_url = qr_info.url;
    entry.expires_at = Date.now() + qr_info.expireIn * 1000;
    entry.qr_data_url = render_qr_code_data_url(qr_info.url);
    return to_view(entry);
  }

  /**
   * 读取一次注册会话的最新状态。
   *
   * 待完成会话超过有效期时会被就地取消并标记为过期。
   */
  read(registration_id: string): FeishuAppRegistrationView {
    const entry = this.require_entry(registration_id);
    if (entry.state === "pending" && entry.expires_at > 0 && Date.now() >= entry.expires_at) {
      entry.controller.abort();
      entry.state = "expired";
      entry.error = "二维码已过期，请重新生成";
      this.schedule_cleanup(entry);
    }
    return to_view(entry);
  }

  /** 取消一次尚未完成的注册会话。 */
  cancel(registration_id: string): void {
    const entry = this.require_entry(registration_id);
    if (entry.state !== "pending") return;
    entry.controller.abort();
    entry.state = "cancelled";
    entry.error = "注册已取消";
    this.schedule_cleanup(entry);
  }

  /** 释放全部会话、定时器和在途轮询。 */
  dispose(): void {
    for (const entry of this.registrations.values()) {
      entry.controller.abort();
      if (entry.cleanup_timer) clearTimeout(entry.cleanup_timer);
      entry.cleanup_timer = undefined;
    }
    this.registrations.clear();
  }

  /** 读取一个已存在的会话，不存在时抛出可诊断错误。 */
  private require_entry(registration_id: string): RegistrationEntry {
    const entry = this.registrations.get(registration_id);
    if (!entry) throw new Error(`Feishu app registration not found: ${registration_id}`);
    return entry;
  }

  /** 取消失去引用的待完成会话，避免后台轮询空转。 */
  private cancel_pending_registrations(): void {
    for (const entry of this.registrations.values()) {
      if (entry.state !== "pending") continue;
      entry.controller.abort();
      entry.state = "cancelled";
      entry.error = "已被新的注册请求取代";
      this.schedule_cleanup(entry);
    }
  }

  /** 在终态会话过期后移除视图。 */
  private schedule_cleanup(entry: RegistrationEntry): void {
    if (entry.cleanup_timer) return;
    entry.cleanup_timer = setTimeout(() => {
      this.registrations.delete(entry.registration_id);
    }, VIEW_RETENTION_MS);
    entry.cleanup_timer.unref?.();
  }
}
