/**
 * Admin Env 管理命令。
 *
 * 三种模式：
 * - Init：遍历所有 service 的 env 需求，逐一交互式配置
 * - 按 Service 查看：选择一个 service，查看/配置其 env
 * - 直接管理：list / upsert / remove 裸 key-value
 */

import { FederationAdmin } from "@downcity/city";
import { t } from "@/shared/CliLocale.js";
import { adminErrorMessage, isAdminNotFoundError, rethrowAdminAuthError } from "@/federation/admin/auth-error.js";
import type { admin_tui_runtime, admin_tui_select_option } from "@/federation/types/AdminTui.js";

interface EnvRequirement {
  /** 环境变量 key */
  key: string;
  /** 给管理员展示的说明文本 */
  description: string;
  /** 当前是否必须配置 */
  required: boolean;
  /** 当前 City 是否已配置该 key */
  configured: boolean;
  /** 当前值的安全预览 */
  value_preview?: string;
}

interface ServiceEnv {
  /** 逻辑分组 ID */
  id: string;
  /** 分组展示名称 */
  name: string;
  /** 当前分组包含的 env 需求列表 */
  env: EnvRequirement[];
}

export async function manageEnv(a: FederationAdmin, _baseUrl: string, runtime: admin_tui_runtime): Promise<void> {
  while (true) {
    const services = await fetchEnvScopes(a, runtime);

    const choices: admin_tui_select_option[] = [
      {
        label: t({ zh: "初始化（逐项配置）", en: "Init (walk through all)" }),
        value: "__init__",
        hint: t({ zh: "按顺序配置全部缺失 env key", en: "Configure all missing env keys in sequence" }),
      },
      {
        label: t({ zh: "查看全部", en: "List all" }),
        value: "__list__",
        hint: t({ zh: "显示当前 City 已保存的全部环境变量，并以掩码形式预览值。", en: "Show all saved environment variables for this City with masked value previews." }),
      },
      {
        label: t({ zh: "新增或更新", en: "Upsert" }),
        value: "__upsert__",
        hint: t({ zh: "手动输入 key/value，新增一个 env 或覆盖已有 env。", en: "Manually enter key/value to add a new env or overwrite an existing one." }),
      },
      {
        label: t({ zh: "更新", en: "Update" }),
        value: "__update__",
        hint: t({ zh: "从已配置 env 中选择一个 key 并更新它的值。", en: "Select an existing env key and update its value." }),
      },
      {
        label: t({ zh: "移除", en: "Remove" }),
        value: "__remove__",
        hint: t({ zh: "删除一个 env key；删除后依赖该 key 的服务可能变为未就绪。", en: "Delete an env key; dependent services may become not ready." }),
      },
      {
        label: t({ zh: "刷新 runtime cache", en: "Refresh runtime cache" }),
        value: "__refresh__",
        hint: t({ zh: "让当前 City runtime 重新加载 env cache，适合直接改库或批量更新后使用。", en: "Reload the City runtime env cache after direct database edits or batch updates." }),
      },
    ];

    if (services) {
      for (const s of services) {
        const configured = s.env.filter((item) => item.configured).length;
        choices.push({
          label: `  ${s.name} (${configured}/${s.env.length} ${t({ zh: "已配置", en: "configured" })})`,
          value: s.id,
          hint: s.env.map((e) => `${e.key}${e.configured ? "✓" : ""}`).join(", "),
        });
      }
    }

    choices.push(
      { label: t({ zh: "导航", en: "Navigation" }), value: "__section_navigation__", disabled: true },
      {
        label: t({ zh: "返回", en: "Back" }),
        value: "back",
        hint: t({ zh: "返回 Admin 管理菜单", en: "Return to Admin management" }),
      },
    );

    const svcId = await runtime.select("Env", choices);
    if (!svcId || svcId === "back") return;

    if (svcId === "__init__" && services) { await initAllEnv(a, services, runtime); continue; }
    if (svcId === "__list__") { await listAllEnv(a, runtime); continue; }
    if (svcId === "__upsert__") { await upsertEnv(a, runtime); continue; }
    if (svcId === "__update__") { await updateEnv(a, runtime); continue; }
    if (svcId === "__remove__") { await removeEnv(a, runtime); continue; }
    if (svcId === "__refresh__") { await refreshEnv(a, runtime); continue; }

    if (services) {
      const svc = services.find((s) => s.id === svcId);
      if (svc) await configureServiceEnv(a, svc, runtime);
    }
  }
}

// ============================================================
// Init 模式
// ============================================================

async function initAllEnv(
  a: FederationAdmin,
  services: ServiceEnv[],
  runtime: admin_tui_runtime,
): Promise<void> {
  const configuredKeys = new Set(
    services.flatMap((svc) => svc.env.filter((item) => item.configured).map((item) => item.key)),
  );
  let changed = false;
  const lines: string[] = [];

  for (const svc of services) {
    lines.push(`── ${svc.name} ──────────────────────────────`);
    for (const req of svc.env) {
      if (configuredKeys.has(req.key)) {
        lines.push(`  ${req.key} ✓ ${t({ zh: "已设置", en: "already set" })}`);
        continue;
      }

      const label = req.required
        ? `${req.key} (${req.description})`
        : `${req.key} (${req.description}, ${t({ zh: "可选，按 Enter 跳过", en: "optional, press Enter to skip" })})`;

      const value = await runtime.text(label);
      if (!value) {
        if (req.required) {
          lines.push(`  ${req.key} ✗ ${t({ zh: "已跳过（必填）", en: "skipped (required)" })}`);
        }
        continue;
      }

      try {
        await runtime.with_loading(t({ zh: `设置 ${req.key}`, en: `Set ${req.key}` }), async () => await a.env.upsert({ key: req.key, value }));
        configuredKeys.add(req.key);
        lines.push(`  ${req.key} ✓ ${t({ zh: "已设置", en: "set" })}`);
        changed = true;
      } catch (e) {
        rethrowAdminAuthError(e);
        lines.push(`  ${req.key} ✗ ${adminErrorMessage(e)}`);
      }
    }
  }

  lines.push("");
  lines.push(changed
    ? t({ zh: "Env 初始化完成。", en: "Env init complete." })
    : t({ zh: "全部 env key 均已配置。", en: "All env keys are already configured." }));
  await runtime.show_text(t({ zh: "Env 初始化", en: "Env Init" }), lines.join("\n"));
}

// ============================================================
// 直接管理模式
// ============================================================

async function listAllEnv(a: FederationAdmin, runtime: admin_tui_runtime): Promise<void> {
  try {
    const items = await runtime.with_loading("Env", async () => await a.env.list());
    await runtime.show_table({
      title: `${items.length} Env`,
      columns: [t({ zh: "Key", en: "Key" }), t({ zh: "值", en: "Value" })],
      rows: items.map((item) => ({
        cells: [item.key, maskValue(item.value, 40)],
      })),
      empty_message: t({ zh: "尚未配置环境变量。", en: "No env variables configured." }),
    });
  } catch (e) {
    rethrowAdminAuthError(e);
    await runtime.show_message("error", adminErrorMessage(e));
  }
}

async function upsertEnv(a: FederationAdmin, runtime: admin_tui_runtime): Promise<void> {
  const key = await runtime.text(t({ zh: "key", en: "key" }));
  if (!key) return;
  const value = await runtime.text(t({ zh: "值", en: "value" }));
  if (!value) return;
  try {
    await runtime.with_loading(t({ zh: `新增或更新 ${key}`, en: `Upsert ${key}` }), async () => await a.env.upsert({ key, value }));
    await runtime.show_message("success", t({ zh: `已新增或更新：${key}`, en: `upserted: ${key}` }));
  } catch (e) {
    rethrowAdminAuthError(e);
    await runtime.show_message("error", adminErrorMessage(e));
  }
}

async function updateEnv(a: FederationAdmin, runtime: admin_tui_runtime): Promise<void> {
  const items = await fetchCurrentEnv(a);
  if (items.length === 0) {
    await runtime.show_message("info", t({ zh: "没有可更新的环境变量。", en: "No env variables to update." }));
    return;
  }

  const choices = items.map((e) => ({
    label: e.key,
    value: e.key,
    hint: t({ zh: `当前：${maskValue(e.value, 20)}`, en: `current: ${maskValue(e.value, 20)}` }),
  }));
  choices.push({
    label: t({ zh: "取消", en: "Cancel" }),
    value: "__cancel__",
    hint: t({ zh: "不修改并返回", en: "Return without changes" }),
  });

  const key = await runtime.select(t({ zh: "选择要更新的 key", en: "Select key to update" }), choices);
  if (!key || key === "__cancel__") return;

  const current = items.find((e) => e.key === key)!;
  const value = await runtime.text(t({
    zh: `新值（当前：${maskValue(current.value, 16)}）`,
    en: `New value (current: ${maskValue(current.value, 16)})`,
  }));
  if (!value) return;

  try {
    await runtime.with_loading(t({ zh: `更新 ${String(key)}`, en: `Update ${String(key)}` }), async () => await a.env.upsert({ key: key as string, value }));
    await runtime.show_message("success", t({ zh: `已更新：${key}`, en: `updated: ${key}` }));
  } catch (e) {
    rethrowAdminAuthError(e);
    await runtime.show_message("error", adminErrorMessage(e));
  }
}

async function removeEnv(a: FederationAdmin, runtime: admin_tui_runtime): Promise<void> {
  const key = await runtime.text(t({ zh: "key", en: "key" }));
  if (!key) return;
  try {
    await runtime.with_loading(t({ zh: `移除 ${key}`, en: `Remove ${key}` }), async () => await a.env.remove(key));
    await runtime.show_message("success", t({ zh: `已移除：${key}`, en: `removed: ${key}` }));
  } catch (e) {
    rethrowAdminAuthError(e);
    await runtime.show_message("error", adminErrorMessage(e));
  }
}

async function refreshEnv(a: FederationAdmin, runtime: admin_tui_runtime): Promise<void> {
  try {
    const result = await runtime.with_loading(t({ zh: "刷新 Env", en: "Refresh Env" }), async () => await a.env.refresh());
    await runtime.show_message("success", t({
      zh: `env runtime cache 已刷新（${result.count} 个 key）`,
      en: `env runtime cache refreshed (${result.count} keys)`,
    }));
  } catch (e) {
    rethrowAdminAuthError(e);
    await runtime.show_message("error", adminErrorMessage(e));
  }
}

// ============================================================
// 按 Service 查看
// ============================================================

async function configureServiceEnv(
  a: FederationAdmin,
  svc: ServiceEnv,
  runtime: admin_tui_runtime,
): Promise<void> {
  while (true) {
    const scopes = await fetchEnvScopes(a, runtime);
    const currentScope = scopes?.find((item) => item.id === svc.id) ?? svc;

    const choices = currentScope.env.map((req) => {
      const status = req.configured
        ? `✓ ${t({ zh: "已配置", en: "configured" })}${req.value_preview ? ` (${req.value_preview})` : ""}`
        : (req.required ? `✗ ${t({ zh: "缺失", en: "MISSING" })}` : `○ ${t({ zh: "未设置", en: "unset" })}`);
      return { label: req.key, value: req.key, hint: `${req.description} [${status}]` };
    });
    choices.push({
      label: t({ zh: "返回", en: "Back" }),
      value: "back",
      hint: t({ zh: "返回 env 菜单", en: "Return to env menu" }),
    });

    const key = await runtime.select(t({ zh: `${svc.name} - 配置`, en: `${svc.name} - configure` }), choices);
    if (!key || key === "back") return;

    const req = currentScope.env.find((e) => e.key === key)!;
    const hint = req.configured
      ? t({
        zh: `（当前：${req.value_preview ?? "已配置"}，输入新值以替换）`,
        en: `(current: ${req.value_preview ?? "configured"}, enter a new value to replace it)`,
      })
      : "";
    const value = await runtime.text(`${req.description} ${hint}`);
    if (!value) continue;

    try {
      if (value) {
        await runtime.with_loading(t({ zh: `设置 ${req.key}`, en: `Set ${req.key}` }), async () => await a.env.upsert({ key: req.key, value }));
        await runtime.show_message("success", t({ zh: `已设置 ${req.key}`, en: `set ${req.key}` }));
      }
    } catch (e) {
      rethrowAdminAuthError(e);
      await runtime.show_message("error", adminErrorMessage(e));
    }
  }
}

// ============================================================
// 工具
// ============================================================

async function fetchEnvScopes(
  a: FederationAdmin,
  runtime: admin_tui_runtime,
): Promise<ServiceEnv[] | undefined> {
  try {
    const scopes = await runtime.with_loading(t({ zh: "Env 目录", en: "Env Catalog" }), async () => await a.env.catalog());
    if (scopes.length === 0) {
      await runtime.show_message("info", t({
        zh: "没有找到需要 env 的服务或 AI 模型。",
        en: "No services or AI models with env requirements found.",
      }));
      return undefined;
    }
    return scopes;
  } catch (e) {
    rethrowAdminAuthError(e);
    if (isAdminNotFoundError(e)) {
      await runtime.show_message("error", t({
        zh: "当前连接的 City 版本过旧，尚未暴露 /v1/env/catalog。请先部署最新的 worker/server。",
        en: "Connected City is too old and does not expose /v1/env/catalog yet. Deploy the latest worker/server first.",
      }));
      return undefined;
    }
    await runtime.show_message("error", t({
      zh: `获取 env 目录失败：${adminErrorMessage(e)}`,
      en: `Failed to fetch env catalog: ${adminErrorMessage(e)}`,
    }));
    return undefined;
  }
}

async function fetchCurrentEnv(a: FederationAdmin): Promise<{ key: string; value: string }[]> {
  try {
    return await a.env.list();
  } catch (e) {
    rethrowAdminAuthError(e);
    return [];
  }
}

function maskValue(v: string, n: number): string {
  return v.length <= n ? v : v.slice(0, n) + "...";
}
