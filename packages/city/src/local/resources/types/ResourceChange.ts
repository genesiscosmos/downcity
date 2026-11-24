/** 已提交的低频资源变更；只传身份与版本，不携带秘密或编辑器状态。 */
export interface ResourceChange {
  /** 变更资源所属领域；运行中消息、进度和 Session mutation 使用既有专用通道。 */
  kind: "agent" | "workspace" | "environment" | "power" | "city_token" | "settings" | "group" | "town" | "extension" | "city_remote";
  /** 领域内稳定身份；全局偏好或环境使用 global。 */
  id: string;
  /** 已提交的创建、更新或删除。 */
  operation: "created" | "updated" | "removed";
  /** 仓储支持时提供权威内容版本；不能用通知序号替代存储 revision。 */
  revision?: string;
  /** 资源所属 Agent；存在时用于限定消费范围。 */
  agent_id?: string;
  /** 资源所属 Workspace；缺省环境变更代表 City 全局环境。 */
  workspace_id?: string;
}
