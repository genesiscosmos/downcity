/**
 * Admin Models 只读视图。
 *
 * 关键说明（中文）
 * - 这里不提供模型新增、删除、启停。
 * - 模型定义仍然来自代码注册；admin 只负责查看当前可用状态。
 * - 如果模型缺少 provider key，会在这里直接显示缺失项。
 */

import { FederationAdmin } from "@downcity/city";
import { adminErrorMessage, isAdminNotFoundError, rethrowAdminAuthError } from "@/federation/admin/auth-error.js";
import { t } from "@/shared/CliLocale.js";
import type { admin_tui_runtime } from "@/federation/types/AdminTui.js";

/**
 * 展示全部代码注册模型及其运行状态。
 */
export async function manageModels(a: FederationAdmin, _baseUrl: string, runtime: admin_tui_runtime): Promise<void> {
  try {
    const model_title = t({ zh: "模型", en: "Models" });
    const [modelResp, envCatalog] = await runtime.with_loading(model_title, async () => await Promise.all([
      a.listModels(),
      a.env.catalog(),
    ]));
    const items = modelResp ?? [];
    const aiScope = envCatalog.find((item) => item.id === "ai-models");
    const envMap = new Map(aiScope?.env.map((item) => [item.key, item.configured]) ?? []);

    if (items.length === 0) {
      await runtime.show_message("info", t({
        zh: "当前 server 没有已注册的 models。",
        en: "No models registered on server.",
      }));
      return;
    }

    await runtime.show_table({
      title: t({ zh: `${items.length} 个模型`, en: `${items.length} Models` }),
      columns: [
        t({ zh: "名称", en: "Name" }),
        t({ zh: "状态", en: "Status" }),
        t({ zh: "模态", en: "Modalities" }),
        "Env",
        t({ zh: "说明", en: "Description" }),
      ],
      rows: items.map((model) => {
        const requirements = model.env_requirements ?? [];
        const missingEnv = requirements
          .filter((item) => item.required && !envMap.get(item.key))
          .map((item) => item.key);
        const status = missingEnv.length === 0
          ? t({ zh: "就绪", en: "READY" })
          : t({ zh: `缺失 ${missingEnv.join(", ")}`, en: `MISSING ${missingEnv.join(", ")}` });
        const envText = requirements.length > 0
          ? requirements
            .map((item) => `${item.key}${envMap.get(item.key) ? "✓" : "✗"}`)
            .join(", ")
          : t({ zh: "无", en: "none" });
        return {
          cells: [
            `${model.name} (${model.id})`,
            status,
            model.modalities.join(", ") || t({ zh: "无", en: "none" }),
            envText,
            model.description ?? "",
          ],
        };
      }),
    });
  } catch (e) {
    rethrowAdminAuthError(e);
    if (isAdminNotFoundError(e)) {
      await runtime.show_message("error", t({
        zh: "当前连接的 City 版本过旧，尚未暴露 /v1/env/catalog。请先部署最新的 worker/server。",
        en: "Connected City is too old and does not expose /v1/env/catalog yet. Deploy the latest worker/server first.",
      }));
      return;
    }
    await runtime.show_message("error", adminErrorMessage(e));
  }
}
