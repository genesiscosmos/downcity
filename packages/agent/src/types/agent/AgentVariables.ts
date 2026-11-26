/**
 * Agent 级通用 JSON 变量协议。
 *
 * 键和值的业务含义由宿主定义；变量不进入提示词、Shell 或模型工具。
 * undefined 表示键不存在，null 是可持久化值；对象比较忽略字段顺序。
 */
export type AgentVariableValue = null | boolean | number | string | AgentVariableValue[] | {
  /** 宿主定义的 JSON 对象字段，禁止 undefined、函数与循环引用。 */
  [key: string]: AgentVariableValue;
};

/** 与 Agent storage 共用生命周期的异步键值能力。 */
export interface AgentVariables {
  /** 读取独立 JSON 副本；键不存在时返回 undefined。 */
  get(key: string): Promise<AgentVariableValue | undefined>;
  /** 原子替换完整 JSON 值，不合并对象字段。 */
  set(key: string, value: AgentVariableValue): Promise<void>;
  /** 原子删除键，返回本次是否删除已有值。 */
  delete(key: string): Promise<boolean>;
  /** 按 JSON 结构比较并原子替换；expected_value/new_value 为 undefined 分别表示缺失/删除。 */
  compare_exchange(key: string, expected_value: AgentVariableValue | undefined, new_value: AgentVariableValue | undefined): Promise<boolean>;
}
