/** Email 配置校验与脱敏投影；账号凭据以 Power 配置为唯一事实源。 */
import { z } from "zod";
import type { EmailAccount, EmailAccountView } from "./types/Email.js";

const server_schema = z
  .object({
    host: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .regex(/^[a-zA-Z0-9.:-]+$/),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    user: z.string().min(1).max(320),
    password: z.string().min(1).max(4096),
  })
  .strict();
export const account_schema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    label: z.string().trim().min(1).max(100),
    address: z.email(),
    imap: server_schema,
    smtp: server_schema,
  })
  .strict();
const config_schema = z
  .object({ accounts: z.array(account_schema).max(30).default([]) })
  .superRefine((config, context) => {
    if (
      new Set(config.accounts.map((account) => account.id)).size !==
      config.accounts.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Account IDs must be unique",
      });
    }
  });
const patch_schema = account_schema.extend({
  imap: server_schema.extend({ password: z.string().max(4096).optional() }),
  smtp: server_schema.extend({ password: z.string().max(4096).optional() }),
});
/** 校验持久配置，拒绝不完整的账号。 */
export function read_accounts(config: unknown): EmailAccount[] {
  return config_schema.parse(config).accounts;
}
/** 生成不回显认证密码的界面及 Agent 视图。 */
export function public_accounts(config: unknown): {
  accounts: EmailAccountView[];
} {
  return {
    accounts: read_accounts(config).map((account) => {
      const { password: imap_password, ...imap } = account.imap;
      const { password: smtp_password, ...smtp } = account.smtp;
      return {
        ...account,
        imap: { ...imap, password_configured: Boolean(imap_password) },
        smtp: { ...smtp, password_configured: Boolean(smtp_password) },
      };
    }),
  };
}
/** 全量替换账号；未提交密码时仅保留相同账号和认证目标的密码。 */
export function save_accounts(
  input: unknown,
  config: unknown,
): { accounts: EmailAccount[] } {
  const patch = z
    .object({ accounts: z.array(patch_schema).max(30) })
    .strict()
    .parse(input);
  const current = read_accounts(config);
  const accounts = patch.accounts.map((account) => {
    const previous = current.find((item) => item.id === account.id);
    const resolve_password = (kind: "imap" | "smtp") => {
      const next = account[kind];
      const old = previous?.[kind];
      return (
        next.password ||
        (old &&
        old.host === next.host &&
        old.user === next.user &&
        old.port === next.port &&
        old.secure === next.secure
          ? old.password
          : "")
      );
    };
    return {
      ...account,
      imap: { ...account.imap, password: resolve_password("imap") },
      smtp: { ...account.smtp, password: resolve_password("smtp") },
    };
  });
  return config_schema.parse({ accounts });
}
/** 解析显式账号，避免隐式选择发送身份。 */
export function resolve_account(
  config: unknown,
  account_id: string,
): EmailAccount {
  const account = read_accounts(config).find((item) => item.id === account_id);
  if (!account) throw new Error("Email account is not configured");
  return account;
}
