/** 配置需求使用专用异常，普通项目错误不会被误当成待配置请求。 */
import type { ExtensionConfigurationField } from "../types/ExtensionProject.js";
import { ExtensionFailure } from "./ExtensionError.js";

/** 宿主识别的结构化请求；不携带字段值或秘密。 */
export class ExtensionConfigurationRequest extends ExtensionFailure {
  constructor(readonly fields: readonly ExtensionConfigurationField[]) {
    super("configuration_required", "Extension requires configuration", "load", 3, { fields: fields.map((field) => ({ name: field.name, description: field.description, secret: field.secret === true })) });
    const names = new Set<string>();
    for (const field of fields) {
      if (!/^[a-z][a-z0-9_]*$/u.test(field.name) || !field.description?.trim() || names.has(field.name)) throw new ExtensionFailure("configuration_invalid", "Configuration fields require unique snake_case names and descriptions", "load", 2);
      names.add(field.name);
    }
  }
}
