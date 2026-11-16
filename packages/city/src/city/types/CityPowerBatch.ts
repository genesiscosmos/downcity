/** City 批量 Power 的暂存所有权协议：先接管资源，再初始化，最后同步发布。 */
export interface CityPowerBatch {
  /** 使用 City 分配的稳定上下文初始化全部实例；期间不发布工具或目录。 */
  initialize(): Promise<void>;
  /** 同步发布已经初始化的整批能力，只有此时进入公开目录。 */
  publish(): void;
  /** 撤销并释放整批资源；未初始化的实例也使用同一上下文清理。 */
  dispose(): Promise<void>;
}
