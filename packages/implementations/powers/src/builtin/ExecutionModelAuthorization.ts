/** 后台执行的模型授权校验；只检查 Turn 已捕获的事实，不创建或替换模型客户端。 */
import { is_model_reference, same_model } from "@downcity/type";
import type { ModelReference } from "@downcity/type";
import type { PowerTown } from "@downcity/city/power";

/** 将实际执行模型与领域已确认基线比较，并核对 Town 当前授权仍可用。 */
export function assert_execution_model(
  baseline: { /** 领域记录已确认的模型来源。 */ model: ModelReference; /** 领域记录已确认的非秘密授权。 */ binding_id: string },
  actual: unknown,
  town: PowerTown | undefined,
): void {
  if (!actual || typeof actual !== "object" || !("model_reference" in actual) || !("binding_id" in actual) || !("model_id" in actual)
    || !is_model_reference(actual.model_reference) || !same_model(actual.model_reference, baseline.model)
    || actual.model_id !== baseline.model.id || actual.binding_id !== baseline.binding_id) {
    throw Object.assign(new Error("Execution Agent model differs from the confirmed model and authorization; configure the Agent and explicitly confirm a new job"), { code: "execution_model_authorization_changed" });
  }
  if (!town) throw new Error("Execution model authorization requires Town");
  town.models.client(baseline.model, { binding_id: baseline.binding_id });
}
