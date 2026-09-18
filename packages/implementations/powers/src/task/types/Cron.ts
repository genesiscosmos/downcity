/**
 * cron 触发定义。
 */
export type TaskCronTriggerDefinition = {
  /** 当前 timer engine 内唯一的 job ID。 */
  id: string;
  /** node-cron 接受的 cron 表达式。 */
  expression: string;
  /** cron 表达式使用的可选 IANA 时区。 */
  timezone?: string;
  /** timer 到点后执行的 TaskPower 回调。 */
  execute: () => Promise<void> | void;
};

/**
 * cron 引擎端口。
 */
export type TaskCronEngine = {
  /** 登记或替换一个定时触发定义。 */
  register(definition: TaskCronTriggerDefinition): void;
  /** 删除一个已登记的定时触发定义。 */
  unregister(id: string): void;
  /** 启动当前已登记定义对应的 timer。 */
  start(): Promise<void>;
  /** 停止全部 timer。 */
  stop(): Promise<void>;
};
