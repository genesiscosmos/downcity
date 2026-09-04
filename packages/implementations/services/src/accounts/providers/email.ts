/**
 * Email accounts provider 工厂。
 *
 * 关键说明（中文）
 * - email 只是 AccountsService 的一个 provider。
 * - 是否可用由调用方传入的发送能力和可选 enabled 判断决定。
 */

import type { AccountsEmailProvider, EmailAccountsProviderOptions } from "../types.js";

/**
 * 创建 Email accounts provider。
 */
export function emailAccountsProvider(options: EmailAccountsProviderOptions): AccountsEmailProvider {
  const label = options.label?.trim() || "Email";
  return {
    id: "email",
    label,
    type: "password",
    env: options.env ?? [],
    method(ctx) {
      const enabled = options.enabled ? options.enabled(ctx) : true;
      return {
        id: "email",
        type: "input",
        enabled,
        label,
        inputs: [
          {
            name: "email",
            type: "text",
            label: "Email",
            required: true,
          },
          {
            name: "password",
            type: "password",
            label: "Password",
            required: true,
          },
        ],
        login_enabled: enabled,
        register_enabled: enabled,
        reason: enabled ? undefined : "not_configured",
      };
    },
    send_email: options.send_email,
  };
}
