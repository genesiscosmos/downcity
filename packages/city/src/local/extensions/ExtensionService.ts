/** CLI、Desktop IPC 与本机管理通道共用的扩展用例白名单，不接收任意对象方法路径。 */
import type { ResourceDispatcher } from "../resources/ManagementChannel.js";
import type { ExtensionPlatform } from "./ExtensionPlatform.js";
import type { ExtensionManager } from "./ExtensionManager.js";
import { ExtensionFailure } from "./ExtensionError.js";

/** 项目业务输入统一在共享入口校验。 */
export class ExtensionService implements ResourceDispatcher {
  readonly capabilities = ["extension.list", "extension.show", "extension.add", "extension.reload", "extension.configure", "extension.configuration", "extension.remove", "extension.operation", "extension.definitions", "extension.connections", "extension.powers"] as const;

  constructor(private readonly manager: ExtensionManager, private readonly platform?: ExtensionPlatform) {}

  async dispatch(method: string, input: Record<string, unknown>): Promise<unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ExtensionFailure("input_invalid", "Extension input must be an object", "source", 2);
    const operation_id = optional_string(input.operation_id);
    const id = () => {
      if (typeof input.extension_id !== "string" || !input.extension_id.trim()) throw new ExtensionFailure("input_invalid", "A complete extension_id is required", "source", 2);
      return input.extension_id;
    };
    switch (method) {
      case "extension.list": return this.manager.list();
      case "extension.powers": return this.platform?.power_catalog() ?? [];
      case "extension.definitions": return this.platform?.definitions().map((definition) => ({ id: definition.id, name: definition.name, description: definition.description ?? "", model_id: definition.behavior.model?.id ?? null })) ?? [];
      case "extension.connections": return this.platform?.connections() ?? { items: [], unavailable: false };
      case "extension.show": return this.manager.show(id());
      case "extension.configuration": return await this.manager.configuration(id());
      case "extension.operation": {
        if (!operation_id) throw new ExtensionFailure("input_invalid", "operation_id is required", "source", 2);
        return this.manager.operation(operation_id);
      }
      case "extension.add": {
        if (typeof input.source !== "string") throw new ExtensionFailure("input_invalid", "An extension source is required", "source", 2);
        return await this.manager.add(input.source, optional_string(input.cwd), optional_string(input.ref), operation_id);
      }
      case "extension.reload": return await this.manager.reload(id(), operation_id);
      case "extension.remove": return await this.manager.remove(id(), operation_id);
      case "extension.configure": {
        const configuration = input.configuration;
        if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) throw new ExtensionFailure("input_invalid", "configuration must be a JSON object", "source", 2);
        const secrets = input.secrets ?? {};
        if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) throw new ExtensionFailure("input_invalid", "secrets must be an object of requested string fields", "source", 2);
        return await this.manager.configure(id(), configuration as Record<string, unknown>, operation_id, secrets as Record<string, string>);
      }
      default: throw new ExtensionFailure("capability_missing", "Current host does not support this extension operation", "host", 5);
    }
  }
}

/** 可选参数一旦出现必须有正确类型，不静默忽略。 */
function optional_string(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new ExtensionFailure("input_invalid", "Extension string arguments must be nonempty strings", "source", 2);
  return value;
}
