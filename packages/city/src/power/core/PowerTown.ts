/** Power 的 Town 能力投影；运行时也只交付允许的方法，避免仅靠类型隐藏管理入口。 */
import type { PowerTown } from "@/power/types/PowerTown.js";

/** 绑定方法的真实 receiver，同时隐藏底层注册集合、模型注册和资源关闭能力。 */
export function create_power_town(town: PowerTown): PowerTown {
  return Object.freeze({
    models: Object.freeze({
      list: town.models.list.bind(town.models),
      client: town.models.client.bind(town.models),
      decision: town.models.decision.bind(town.models),
      image_create: town.models.image_create.bind(town.models),
      image_result: town.models.image_result.bind(town.models),
      tts: town.models.tts.bind(town.models),
      asr: town.models.asr.bind(town.models),
    }),
    services: Object.freeze({
      list: town.services.list.bind(town.services),
      describe: town.services.describe.bind(town.services),
      call: town.services.call.bind(town.services),
    }),
  });
}
