/**
 * Admin City 说明文档查看命令。
 */

import { FederationAdmin } from "@downcity/city";
import { t } from "@/shared/CliLocale.js";
import type { admin_tui_runtime } from "@/federation/types/AdminTui.js";

/**
 * 展示当前 City 聚合后的说明文档。
 */
export async function manageInstruction(
  a: FederationAdmin,
  _baseUrl: string,
  runtime: admin_tui_runtime,
): Promise<void> {
  const title = t({
    zh: "City 说明",
    en: "City guide",
  });
  const content = await runtime.with_loading(title, async () => await a.instruction());
  await runtime.show_text(title, content);
}
