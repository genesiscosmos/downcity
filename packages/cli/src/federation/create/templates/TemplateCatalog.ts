/**
 * Federation 内置模板目录。
 *
 * 交互界面和非交互 `--template` 解析都使用同一份目录，避免模板 ID 漂移。
 */

import { create_cloudflare_workers_template_files } from "@/federation/create/templates/CloudflareWorkersTemplate.js";
import { create_local_node_template_files } from "@/federation/create/templates/LocalNodeTemplate.js";
import type { FederationTemplateDefinition } from "@/federation/types/FederationTemplate.js";

/** 默认模板优先支持本机立即 deploy。 */
export const DEFAULT_FEDERATION_TEMPLATE_ID = "local-node";

/** 当前 CLI 内置的 Federation 模板。 */
export const FEDERATION_TEMPLATES: FederationTemplateDefinition[] = [
  {
    id: "local-node",
    label: "Local Node.js",
    hint: "Local process with SQLite, deployed by fed deploy",
    create_files: create_local_node_template_files,
  },
  {
    id: "cloudflare-workers",
    label: "Cloudflare Workers",
    hint: "Edge Worker with D1, Queue and R2",
    create_files: create_cloudflare_workers_template_files,
  },
];

/** 根据稳定 ID 读取内置模板。 */
export function read_federation_template(
  template_id: string,
): FederationTemplateDefinition | undefined {
  return FEDERATION_TEMPLATES.find((template) => template.id === template_id);
}
