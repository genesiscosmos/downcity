/**
 * cron 触发定义。
 */
export type TaskCronTriggerDefinition = {
  id: string;
  expression: string;
  timezone?: string;
  execute: () => Promise<void> | void;
};

/**
 * cron 引擎端口。
 */
export type TaskCronEngine = {
  register(definition: TaskCronTriggerDefinition): void;
};
