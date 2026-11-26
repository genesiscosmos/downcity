/**
 * PowerContext 构造。
 *
 * 关键点（中文）
 * - 本模块只做「把已解析的值装成一个 PowerContext」，不做反查、不分配存储。
 *   反查与分配属于容器职责，由 `PowerRuntimeHost` 实现者完成。
 * - 活值（Workspace env、Agent instruction）通过 getter 延迟读取，与快照语义区分。
 * - 嵌套 power 调用沿用本次调用的来源身份，因此组合 power 不会丢掉交互能力。
 */

import type { FileSystem } from "@/workspace/index.js";
import type {
  PowerJsonObject,
  PowerJsonValue,
  PowerNotificationPublisher,
  PowerSessionHandle,
} from "@/power/index.js";
import type { PowerAgentHandle, PowerCityHandle, PowerLogger, PowerWorkspaceHandle } from "@/power/types/PowerContext.js";
import type { PowerCall } from "@/power/types/PowerCall.js";
import type { StepSnapshot } from "@/power/types/StepSnapshot.js";
import { PowerContext } from "@/power/types/PowerContext.js";
import { redact_public_value } from "./PowerPrivateValues.js";

/** PowerContext 构造输入；全部字段都已由容器解析完成。 */
export interface CreatePowerContextInput {
  /** City 为本次调用提供的统一领域能力。 */
  readonly city: PowerCityHandle;
  /** 从 City 目录绑定的当前 Agent 句柄。 */
  readonly agent: PowerAgentHandle;
  /** 从 City 目录绑定的当前 Workspace 句柄。 */
  readonly workspace?: PowerWorkspaceHandle;
  /** 当前 Power 私有数据根路径。 */
  readonly data_path: string;
  /** 当前 Power 私有数据文件端口。 */
  readonly data_files: FileSystem;
  /** 当前调用所属 Session 句柄；非 Session 调用时为空。 */
  readonly session?: PowerSessionHandle;
  /** 当前调用所属 Turn 句柄；非 Turn 调用时为空。 */
  readonly turn?: PowerContext["turn"];
  /** 本步冻结的事实。 */
  readonly snapshot: StepSnapshot;
  /** Downcity 用户级数据根目录。 */
  readonly data_root_path: string;
  /** 本次调用的身份与执行面。 */
  readonly call: PowerCall;
  /** 当前 Power 业务配置。 */
  readonly config: PowerJsonObject;
  /** 当前执行范围日志器。 */
  readonly logger: PowerLogger;
  /** 当前 Power 通知端口。 */
  readonly notifications?: PowerNotificationPublisher;
}

/** 把已解析的值装成一次调用的 PowerContext。 */
export function create_power_context(input: CreatePowerContextInput): PowerContext {
  return new PowerContext({
    city: input.city,
    agent: input.agent,
    ...(input.workspace ? { workspace: input.workspace } : {}),
    ...(input.session ? { session: input.session } : {}),
    ...(input.turn ? { turn: input.turn } : {}),
    snapshot: input.snapshot,
    data_root_path: input.data_root_path,
    call: input.call,
    storage: { path: input.data_path, files: input.data_files },
    config: input.config,
    // Redact before calling the Agent logger, which may persist immediately.
    logger: {
      log: (level, message, details) => input.logger.log(
        level,
        redact_public_value(message, input.call.interactions),
        redact_public_value(details, input.call.interactions),
      ),
      debug: (message, details) => input.logger.debug(
        redact_public_value(message, input.call.interactions),
        redact_public_value(details, input.call.interactions),
      ),
      info: (message, details) => input.logger.info(
        redact_public_value(message, input.call.interactions),
        redact_public_value(details, input.call.interactions),
      ),
      warn: (message, details) => input.logger.warn(
        redact_public_value(message, input.call.interactions),
        redact_public_value(details, input.call.interactions),
      ),
      error: (message, details) => input.logger.error(
        redact_public_value(message, input.call.interactions),
        redact_public_value(details, input.call.interactions),
      ),
    },
    ...(input.notifications ? { notifications: input.notifications } : {}),
  });
}

/** 深拷贝并冻结 Power 配置，避免调用方修改当前执行快照。 */
export function freeze_power_config(input: PowerJsonObject): PowerJsonObject {
  return freeze_json_value(structuredClone(input)) as PowerJsonObject;
}

/** 递归冻结一个 JSON 值。 */
function freeze_json_value(input: PowerJsonValue): PowerJsonValue {
  if (Array.isArray(input)) {
    return Object.freeze(input.map((value) => freeze_json_value(value))) as PowerJsonValue[];
  }
  if (input !== null && typeof input === "object") {
    return Object.freeze(Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, freeze_json_value(value)]),
    )) as PowerJsonObject;
  }
  return input;
}
