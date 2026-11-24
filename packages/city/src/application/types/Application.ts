/** 应用公开导出协议：校验、授权和文档与真实领域实现共同发布。 */
import type { z } from "zod";
import type { PowerContext } from "../../power/index.js";

/** 单次桥接的可信应用调用；脚本只能提供业务参数。 */
export interface ApplicationCall {
  /** City 创建的当前 Power 调用上下文，绝不进入引擎。 */
  readonly context: PowerContext;
  /** 宿主生成的执行标识。 */
  readonly execution_id: string;
  /** 当前调用的可取消信号。 */
  readonly signal: AbortSignal;
}

/** 宿主挂载的公开应用对象；只遍历契约，不反射内部服务。 */
export interface ApplicationObject {
  /** downcity 下的对象名；不能覆盖其他对象。 */
  readonly name: string;
  /** 应用公开接口，函数的输入输出同时用于校验、代理、声明和帮助。 */
  readonly contract: z.ZodObject;
  /** 为本次执行绑定真实对象；闭包持有可信身份与目标引用。 */
  readonly bind: (call: ApplicationCall) => object;
  /** 每次访问检查调用方生命周期与对象权限；业务方法继续检查目标。 */
  readonly authorize: (call: ApplicationCall) => void | Promise<void>;
}

/** 一个执行期内由宿主持有的对象引用；不序列化内部实例。 */
export interface BoundPublicObject {
  /** 真实公开对象，方法通过自己的闭包访问领域服务。 */
  readonly object: object;
  /** 该对象唯一的公开成员契约。 */
  readonly contract: z.ZodObject;
  /** 提供统一 caller 检查的顶层对象。 */
  readonly owner: ApplicationObject;
  /** 可公开的语义路径，用于策略检查与调用回执。 */
  readonly path: string;
}

/** 可选宿主策略；默认 scope 不因 execute 而扩大。 */
export interface ApplicationPolicy {
  /** 检查额外公开能力范围；领域 authorize 仍然执行。 */
  readonly authorize: (symbol: string, input: unknown, call: ApplicationCall) => void | Promise<void>;
}

/** help 与编译共用的可序列化导出描述。 */
export interface ApplicationDescriptor {
  /** 稳定公开方法名。 */
  readonly symbol: string;
  /** 方法用途与副作用约定。 */
  readonly description: string;
  /** 由输入 schema 生成的 TypeScript 类型文本。 */
  readonly input_type: string;
  /** 由输出 schema 生成的 TypeScript 类型文本。 */
  readonly output_type: string;
}
