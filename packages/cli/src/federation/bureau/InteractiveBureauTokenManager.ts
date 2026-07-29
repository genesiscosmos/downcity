/**
 * Federation Bureau Token 交互式管理器。
 *
 * 关键点（中文）
 * - 裸 `fed bureau token` 在一个全屏 TUI 中统一承担创建、查看和撤销。
 * - Token 明文只存在于创建结果页，不会写入列表或再次从 Federation 获取。
 * - 已撤销 Token 仍保留在注册表中，便于管理员审计用途和生命周期。
 */

import type { BureauTokenSummary } from "@downcity/city";
import {
  create_federation_bureau_token_record,
  read_federation_bureau_tokens,
  revoke_federation_bureau_token_record,
} from "@/federation/bureau/commands/bureau.js";
import { ManagedTuiRuntime } from "@/shared/tui/ManagedTuiRuntime.js";
import { t } from "@/shared/CliLocale.js";
import type { tui_prompt_option } from "@/shared/types/TuiPrompt.js";

const TOKEN_ACTION_PREFIX = "token:";

/** 打开当前 active Federation 的 Bureau Token 管理界面。 */
export async function run_interactive_bureau_token_manager(): Promise<void> {
  const runtime = new ManagedTuiRuntime({ title: "Bureau Token" });
  try {
    while (true) {
      const items = await runtime.with_loading(
        t({ zh: "读取 Bureau Token", en: "Loading Bureau tokens" }),
        read_federation_bureau_tokens,
      );
      const selected = await runtime.select({
        title: t({ zh: "Bureau Token 管理", en: "Bureau Token management" }),
        subtitle: t({ zh: `${items.length} 条注册记录`, en: `${items.length} registrations` }),
        footer: t({
          zh: "Enter 选择 · Esc / q 退出 · ↑↓ 切换",
          en: "Enter choose · Esc / q exit · ↑↓ navigate",
        }),
        options: build_manager_options(items),
        show_detail: true,
      });

      if (!selected || selected === "exit") return;
      if (selected === "refresh") continue;
      if (selected === "create") {
        await create_token_interactively(runtime);
        continue;
      }
      if (selected.startsWith(TOKEN_ACTION_PREFIX)) {
        const token_id = selected.slice(TOKEN_ACTION_PREFIX.length);
        const token = items.find((item) => item.token_id === token_id);
        if (token) await manage_token(runtime, token);
      }
    }
  } finally {
    runtime.close();
  }
}

function build_manager_options(items: BureauTokenSummary[]): tui_prompt_option[] {
  const token_options = items.map((item) => ({
    label: item.purpose || t({ zh: "未说明用途", en: "Unspecified purpose" }),
    value: `${TOKEN_ACTION_PREFIX}${item.token_id}`,
    hint: [item.token_id, item.status, item.created_at].join(" · "),
  }));

  return [
    {
      label: t({ zh: "创建 Bureau Token", en: "Create Bureau Token" }),
      value: "create",
      hint: t({
        zh: "输入用途并登记新的部署凭证",
        en: "Enter a purpose and register a deployment credential",
      }),
    },
    ...(token_options.length > 0
      ? [
          {
            label: t({ zh: "注册记录", en: "Registrations" }),
            value: "__section_tokens__",
            disabled: true,
          },
          ...token_options,
        ]
      : []),
    {
      label: t({ zh: "刷新", en: "Refresh" }),
      value: "refresh",
      hint: t({ zh: "重新读取 Federation 注册表", en: "Reload the Federation registry" }),
    },
    {
      label: t({ zh: "退出", en: "Exit" }),
      value: "exit",
    },
  ];
}

async function create_token_interactively(runtime: ManagedTuiRuntime): Promise<void> {
  while (true) {
    const purpose_input = await runtime.text({
      title: t({ zh: "Token 用途", en: "Token purpose" }),
      placeholder: t({ zh: "例如：生产环境支付服务", en: "For example: production payments service" }),
    });
    if (purpose_input === undefined) return;

    const purpose = purpose_input.trim();
    if (!purpose) {
      await runtime.show_message("error", t({
        zh: "Token 用途不能为空。",
        en: "Token purpose cannot be empty.",
      }));
      continue;
    }
    if (purpose.length > 200) {
      await runtime.show_message("error", t({
        zh: "Token 用途不能超过 200 个字符。",
        en: "Token purpose must be at most 200 characters.",
      }));
      continue;
    }

    const created = await runtime.with_loading(
      t({ zh: "登记 Bureau Token", en: "Registering Bureau token" }),
      async () => await create_federation_bureau_token_record(purpose),
    );
    await runtime.show_text(
      t({ zh: "Bureau Token 已登记", en: "Bureau token registered" }),
      [
        `${t({ zh: "用途", en: "Purpose" })}: ${created.purpose}`,
        `Token ID: ${created.token_id}`,
        `DOWNCITY_FEDERATION_URL: ${created.federation_url}`,
        `DOWNCITY_BUREAU_TOKEN: ${created.bureau_token}`,
        "",
        t({
          zh: "Token 明文只显示这一次，请立即写入 Bureau 的部署环境变量。",
          en: "The plaintext token is shown only once. Store it in the Bureau deployment environment now.",
        }),
      ].join("\n"),
    );
    return;
  }
}

async function manage_token(
  runtime: ManagedTuiRuntime,
  token: BureauTokenSummary,
): Promise<void> {
  const options: tui_prompt_option[] = token.status === "active"
    ? [
        {
          label: t({ zh: "撤销 Token", en: "Revoke token" }),
          value: "revoke",
          hint: t({ zh: "撤销后不能恢复", en: "Revocation cannot be undone" }),
        },
        { label: t({ zh: "返回", en: "Back" }), value: "back" },
      ]
    : [{ label: t({ zh: "返回", en: "Back" }), value: "back" }];
  const selected = await runtime.select({
    title: token.purpose || t({ zh: "未说明用途", en: "Unspecified purpose" }),
    subtitle: `${token.token_id} · ${token.status} · ${token.created_at}`,
    footer: t({ zh: "Enter 选择 · Esc 返回", en: "Enter choose · Esc back" }),
    options,
  });
  if (selected !== "revoke") return;

  const confirmed = await runtime.select({
    title: t({ zh: "确认撤销 Bureau Token？", en: "Revoke Bureau Token?" }),
    subtitle: `${token.purpose || token.token_id}\n${token.token_id}`,
    footer: t({ zh: "Enter 选择 · Esc 取消", en: "Enter choose · Esc cancel" }),
    options: [
      {
        label: t({ zh: "确认撤销", en: "Revoke" }),
        value: "confirm",
        hint: t({
          zh: "该 Token 将立即失去 Federation 管理权限",
          en: "The token immediately loses Federation management access",
        }),
      },
      { label: t({ zh: "取消", en: "Cancel" }), value: "cancel" },
    ],
  });
  if (confirmed !== "confirm") return;

  await runtime.with_loading(
    t({ zh: "撤销 Bureau Token", en: "Revoking Bureau token" }),
    async () => await revoke_federation_bureau_token_record(token.token_id),
  );
  await runtime.show_message("success", t({
    zh: `Bureau Token 已撤销：${token.token_id}`,
    en: `Bureau token revoked: ${token.token_id}`,
  }));
}
