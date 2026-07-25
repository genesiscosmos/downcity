/**
 * 跨 package 统一账户权限目录定义。
 *
 * 关键点（中文）
 * - V1 使用稳定的字符串权限 key，避免把权限判断散落在业务代码里。
 * - 默认角色与权限关系也在这里收口，方便 bootstrap 时统一 seed。
 */

/**
 * V1 支持的权限 key 列表。
 */
export const AUTH_PERMISSION_KEYS = [
  "agent.read",
  "agent.write",
  "agent.execute",
  "task.read",
  "task.run",
  "model.read",
  "model.write",
  "env.read",
  "env.write",
  "channel.read",
  "channel.write",
  "auth.read",
  "auth.write",
  "shell.execute",
  "session.read",
  "session.write",
  "plugin.read",
  "plugin.write",
] as const;

/**
 * 权限 key 联合类型。
 */
export type AuthPermissionKey = (typeof AUTH_PERMISSION_KEYS)[number];

/**
 * 权限说明映射。
 */
export const AUTH_PERMISSION_DESCRIPTIONS: Record<AuthPermissionKey, string> = {
  "agent.read": "读取 agent 基础信息与运行状态。",
  "agent.write": "修改 agent 配置与元信息。",
  "agent.execute": "触发 agent 执行与会话运行。",
  "task.read": "查看 task 定义与运行结果。",
  "task.run": "创建或手动执行 task。",
  "model.read": "查看 City AIService 模型与模型绑定。",
  "model.write": "修改模型绑定。",
  "env.read": "查看环境变量配置。",
  "env.write": "修改环境变量配置。",
  "channel.read": "查看渠道账号与渠道状态。",
  "channel.write": "修改渠道账号与渠道配置。",
  "auth.read": "查看统一账户、角色、权限与 token 状态。",
  "auth.write": "修改统一账户、角色、权限与 token 状态。",
  "shell.execute": "执行 shell 指令。",
  "session.read": "查看 session 与消息。",
  "session.write": "修改 session 或写入消息。",
  "plugin.read": "查看 plugin 状态与配置。",
  "plugin.write": "修改 plugin 配置并执行管理动作。",
};

/**
 * 默认角色名称。
 */
export const AUTH_DEFAULT_ROLE_NAMES = ["admin", "operator", "viewer"] as const;

/**
 * 默认角色名称类型。
 */
export type AuthDefaultRoleName = (typeof AUTH_DEFAULT_ROLE_NAMES)[number];

/**
 * 默认角色定义。
 */
export interface AuthDefaultRoleDefinition {
  /**
   * 角色名。
   */
  name: AuthDefaultRoleName;
  /**
   * 角色说明。
   */
  description: string;
  /**
   * 角色拥有的权限集合。
   */
  permissions: AuthPermissionKey[];
}

/**
 * V1 默认角色目录。
 */
export const AUTH_DEFAULT_ROLES: AuthDefaultRoleDefinition[] = [
  {
    name: "admin",
    description: "System administrator who can manage unified accounts and all control-plane capabilities.",
    permissions: [...AUTH_PERMISSION_KEYS],
  },
  {
    name: "operator",
    description: "Operations role that can view and operate the runtime but cannot manage unified accounts.",
    permissions: AUTH_PERMISSION_KEYS.filter((permission) =>
      permission !== "auth.write" && permission !== "auth.read"
    ),
  },
  {
    name: "viewer",
    description: "Read-only role that can view status but cannot perform high-risk changes.",
    permissions: [
      "agent.read",
      "task.read",
      "model.read",
      "env.read",
      "channel.read",
      "auth.read",
      "session.read",
      "plugin.read",
    ],
  },
];
