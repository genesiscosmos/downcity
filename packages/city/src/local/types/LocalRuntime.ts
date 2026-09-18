/** 本地 Power 注册与加载协议。 */

import type { PowerRepository } from "@/local/repositories/PowerRepository.js";
import type { LocalPowerRegistration } from "@/local/types/LocalPower.js";

/** 本地 Power Loader 构造参数。 */
export interface LocalPowerLoaderOptions {
  /** Power 定义与唯一配置使用的文件仓储。 */
  power_repository: PowerRepository;
  /** 当前宿主提供的内置或应用级 Power 注册。 */
  power_registrations?: readonly LocalPowerRegistration[];
}
