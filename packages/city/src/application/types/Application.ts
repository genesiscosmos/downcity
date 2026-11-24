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
  /** 在等待可信审批期间暂停活动预算；返回恢复函数。 */
  readonly pause_budget: () => () => void;
}

/** 公开方法的单一运行时契约；同一契约生成 client、声明和 help。 */
export interface ApplicationExport {
  /** 宿主分配的稳定公开符号，例如 sessions.rename。 */
  readonly symbol: string;
  /** 面向调用者的用途、效果时机和失败语义。 */
  readonly description: string;
  /** 公开输入校验；所有方法使用一个对象参数。 */
  readonly input: z.ZodType;
  /** 公开输出投影校验，不允许内部活对象进入引擎。 */
  readonly output: z.ZodType;
  /** 是否修改应用状态；写方法逐次请求宿主审批。 */
  readonly effect: "read" | "write";
  /** 每次调用、审批后再次执行的领域 scope 检查；不能靠脚本提供 actor。 */
  readonly authorize: (input: unknown, call: ApplicationCall) => void | Promise<void>;
  /** 调用共享领域服务；不得复制产品入口的业务规则。 */
  readonly invoke: (input: unknown, call: ApplicationCall) => unknown | Promise<unknown>;
}

/** 宿主安装的应用模块；模块由组合根授予命名空间。 */
export interface ApplicationModule {
  /** 顶级公开命名空间；禁止覆盖已有模块。 */
  readonly namespace: string;
  /** 此模块全部显式公开方法。 */
  readonly exports: readonly ApplicationExport[];
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
  /** 是否产生写效果。 */
  readonly effect: "read" | "write";
  /** 由输入 schema 生成的 TypeScript 类型文本。 */
  readonly input_type: string;
  /** 由输出 schema 生成的 TypeScript 类型文本。 */
  readonly output_type: string;
}
