/**
 * Admin 命令循环。
 *
 * 关键说明（中文）
 * - `city` 点开某个 City 后直接进入这个菜单。
 * - City 连接配置、admin key 更新等低频操作通过 `更多` 回调交给 workspace 层处理。
 */

import { FederationAdmin } from "@downcity/city";
import { type AdminSession } from "@/federation/core/session.js";
import { adminErrorMessage, isAdminAuthError } from "@/federation/admin/auth-error.js";
import { create_admin_tui_runtime } from "@/federation/tui/AdminTuiRuntime.js";
import type { admin_tui_runtime } from "@/federation/types/AdminTui.js";
import { manageEnv } from "@/federation/admin/commands/service-env.js";
import { manageDashboard } from "@/federation/admin/commands/dashboard.js";
import { manage_bureaus } from "@/federation/admin/commands/bureaus.js";
import { manageAccounts } from "@/federation/admin/commands/accounts.js";
import { manage_credits } from "@/federation/admin/commands/credits.js";
import { manageUsage } from "@/federation/admin/commands/usage.js";
import { managePayment } from "@/federation/admin/commands/payment.js";
import { manageCustom } from "@/federation/admin/commands/custom.js";
import { manageModels } from "@/federation/admin/commands/models.js";
import { manageInstruction } from "@/federation/admin/commands/instruction.js";
import { t } from "@/shared/CliLocale.js";

const commands: Record<string, (a: FederationAdmin, baseUrl: string, runtime: admin_tui_runtime) => Promise<void>> = {
  dashboard: manageDashboard,
  env: manageEnv,
  instruction: manageInstruction,
  models: manageModels,
  bureaus: manage_bureaus,
  accounts: manageAccounts,
  credits: manage_credits,
  usage: manageUsage,
  payment: managePayment,
  custom: manageCustom,
};

export async function adminLoop(
  session: AdminSession,
  options?: {
    embedded?: boolean;
    title?: string;
    on_more?: (runtime: admin_tui_runtime) => Promise<"continue" | "back" | "quit" | "removed">;
    runtime?: admin_tui_runtime;
  },
): Promise<"logout" | "quit" | "switch_identity" | "back"> {
  const admin = new FederationAdmin({
    base_url: session.base_url,
    credential: session.admin_secret_key,
  });
  const embedded = options?.embedded !== false;
  const runtime = options?.runtime ?? create_admin_tui_runtime(options?.title ?? "Admin");

  while (true) {
    const svc = await runtime.select_nav(
      options?.title
        ?? (embedded
          ? t({
            zh: "Admin 管理",
            en: "Admin management",
          })
          : t({
            zh: "管理服务",
            en: "Manage Service",
          })),
      [
        {
          label: t({
            zh: "管理",
            en: "Management",
          }),
          value: "__section_management__",
          disabled: true,
        },
        {
          label: t({
            zh: "用户系统 Dashboard",
            en: "User system dashboard",
          }),
          value: "dashboard",
          hint: t({
            zh: "汇总注册用户、活跃用户、新注册、付费用户、收入、充值和用量等核心指标。",
            en: "Summarize registered users, active users, new users, paid users, revenue, topups, and usage metrics.",
          }),
        },
        {
          label: t({
            zh: "环境变量",
            en: "Env",
          }),
          value: "env",
          hint: t({
            zh: "查看并配置环境变量",
            en: "View and configure environment variables",
          }),
        },
        {
          label: t({
            zh: "模型",
            en: "Models",
          }),
          value: "models",
          hint: t({
            zh: "查看模型就绪状态与缺失 env",
            en: "Read model readiness and missing env requirements",
          }),
        },
        {
          label: t({
            zh: "产品管理",
            en: "Products",
          }),
          value: "bureaus",
          hint: t({
            zh: "管理 Bureau 产品身份、授权域和生命周期；City 仅作为 Agent 终端连接 Bureau。",
            en: "Manage Bureau product identities, authorization domains, and lifecycle. City is an Agent terminal that connects to a Bureau.",
          }),
        },
        {
          label: t({
            zh: "用户管理",
            en: "Users",
          }),
          value: "accounts",
          hint: t({
            zh: "查看 Federation 用户与登录会话，确认用户身份、邮箱和会话状态。",
            en: "Inspect Federation users and login sessions, including identity, email, and session status.",
          }),
        },
        {
          label: t({
            zh: "Credits",
            en: "Credits",
          }),
          value: "credits",
          hint: t({
            zh: "管理用户永久与限时 Cards、额度变动和不可变流水。",
            en: "Manage primary and ephemeral cards, credit transactions, and immutable history.",
          }),
        },
        {
          label: t({
            zh: "用量统计",
            en: "Usage analytics",
          }),
          value: "usage",
          hint: t({
            zh: "查看 Bureau/产品维度的 service 调用事件与聚合统计。",
            en: "View service-call events and summaries by Bureau/product.",
          }),
        },
        {
          label: t({
            zh: "支付方式",
            en: "Payment methods",
          }),
          value: "payment",
          hint: t({
            zh: "查看当前 City 已注册或启用的支付方式；当前包含 Stripe webhook 配置、支付记录与 webhook 事件。",
            en: "Inspect registered or enabled payment methods. Currently includes Stripe webhook setup, payment records, and webhook events.",
          }),
        },
        {
          label: t({
            zh: "服务调试",
            en: "Service debugger",
          }),
          value: "custom",
          hint: t({
            zh: "输入任意 service id 与 path，用 GET/POST 调试 City 暴露的服务动作。",
            en: "Enter any service id and path to debug City service actions with GET or POST.",
          }),
        },
        {
          label: t({
            zh: "City 说明",
            en: "City guide",
          }),
          value: "instruction",
          hint: t({
            zh: "查看当前 City 聚合后的 agent/service instruction，适合了解这个 City 对外暴露的能力说明。",
            en: "Read the aggregated agent/service instruction for this City and its exposed capabilities.",
          }),
        },
        ...(options?.on_more
          ? [
            {
              label: t({
                zh: "低频设置",
                en: "Settings",
              }),
              value: "__section_settings__",
              disabled: true,
            },
            {
              label: t({
                zh: "更多",
                en: "More",
              }),
              value: "more",
              hint: t({
                zh: "更新 admin 访问、编辑当前 Federation 本地连接记录，或移除当前 Federation。",
                en: "Update admin access, edit the current local Federation connection, or remove this Federation.",
              }),
            },
          ]
          : []),
        {
          label: t({
            zh: "导航",
            en: "Navigation",
          }),
          value: "__section_navigation__",
          disabled: true,
        },
        ...(embedded
          ? [{
            label: t({
              zh: "返回",
              en: "Back",
            }),
            value: "back",
          }]
          : [
            {
              label: t({
                zh: "切换到 User",
                en: "Switch to User",
              }),
              value: "switch",
            },
            {
              label: t({
                zh: "退出登录",
                en: "Logout",
              }),
              value: "logout",
            },
          ]),
        {
          label: t({
            zh: "退出",
            en: "Quit",
          }),
          value: "quit",
        },
      ],
    );
    if (!svc) {
      runtime.close();
      return embedded ? "back" : "quit";
    }

    if (svc === "quit") {
      runtime.close();
      return "quit";
    }
    if (svc === "back") {
      runtime.close();
      return "back";
    }
    if (svc === "more" && options?.on_more) {
      const result = await options.on_more(runtime);
      if (result === "quit") {
        runtime.close();
        return "quit";
      }
      if (result === "back" || result === "removed") {
        runtime.close();
        return "back";
      }
      continue;
    }
    if (svc === "logout") {
      await runtime.show_message("success", t({
        zh: "已退出 admin 模式",
        en: "left admin mode",
      }));
      runtime.close();
      return "logout";
    }
    if (svc === "switch") {
      runtime.close();
      return "switch_identity";
    }

   try {
     const command_key = String(svc);
      const command = commands[command_key];
      if (command === undefined) {
        await runtime.show_message(
          "error",
          t({
            zh: "暂不支持该选项",
            en: "This option is not supported",
          }),
        );
        continue;
      }
      await command(admin, session.base_url, runtime);
    } catch (e) {
      if (isAdminAuthError(e)) {
        await runtime.show_message("error", adminErrorMessage(e));
        runtime.close();
        return "logout";
      }
      await runtime.show_message("error", adminErrorMessage(e));
    }
  }
}
