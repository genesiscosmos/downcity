/**
 * Federation env requirement 聚合模块。
 *
 * 负责把 service.env 与 AI 模型 env requirement 汇总成统一目录。
 */

import { AIService } from "../service/ai/ai-service.js";
import type { Service } from "../service/service.js";
import type { EnvCatalogScope, EnvRequirementStatus } from "../service/env/types.js";
import type { EnvProvider } from "./runtime.js";

/**
 * 聚合当前 Federation 暴露的 env requirement。
 */
export function collect_federation_env_catalog(
  services: Service[],
  env_provider: EnvProvider,
): EnvCatalogScope[] {
  const scopes: EnvCatalogScope[] = [];

  for (const service of services) {
    if ((service.env?.length ?? 0) === 0) continue;
    scopes.push({
      id: service.id,
      name: service.name,
      env: service.env!.map((item) => ({
        key: item.key,
        description: item.description,
        required: item.required,
        configured: Boolean(env_provider.get(item.key)),
        value_preview: preview_env_value(env_provider.get(item.key)),
      })),
    });
  }

  const ai_scope = collect_ai_model_env_catalog(services, env_provider);
  if (ai_scope) scopes.push(ai_scope);

  return scopes;
}

/**
 * 聚合 AI 模型的 env requirement。
 */
function collect_ai_model_env_catalog(
  services: Service[],
  env_provider: EnvProvider,
): EnvCatalogScope | undefined {
  const aggregated = new Map<string, {
    description: string;
    required: boolean;
    models: string[];
  }>();

  for (const service of services) {
    if (!(service instanceof AIService)) continue;

    const models = AIService.listModels(service, {
      env: () => undefined,
      identity: "admin",
    });

    for (const model of models) {
      for (const item of model.env_requirements ?? []) {
        const current = aggregated.get(item.key);
        if (current) {
          current.models.push(model.name);
          current.required = current.required || item.required;
          continue;
        }
        aggregated.set(item.key, {
          description: item.description,
          required: item.required,
          models: [model.name],
        });
      }
    }
  }

  if (aggregated.size === 0) return undefined;

  const env: EnvRequirementStatus[] = [...aggregated.entries()].map(([key, item]) => ({
    key,
    description: `${item.description} - used by ${item.models.join(", ")}`,
    required: item.required,
    configured: Boolean(env_provider.get(key)),
    value_preview: preview_env_value(env_provider.get(key)),
  }));

  return {
    id: "ai-models",
    name: "AI Models",
    env,
  };
}

/**
 * 生成 env 值预览。
 */
function preview_env_value(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length <= 8) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
