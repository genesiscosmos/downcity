/**
 * `city agent create` Workspace 解析类型。
 */

/** 无路径参数时允许用户选择的 Workspace 来源。 */
export type AgentCreateWorkspaceMode = "current" | "choose";

/** 可测试的 Agent Create Workspace 解析输入。 */
export interface ResolveAgentCreateWorkspaceInput {
  /** 命令行传入的相对或绝对路径；缺失时进入交互流程。 */
  path_argument?: string;
  /** 命令执行时的当前工作目录。 */
  current_directory: string;
  /** 当前标准输入和输出是否支持交互。 */
  interactive: boolean;
  /** 选择当前目录或打开系统文件夹选择窗口。 */
  select_mode: () => Promise<AgentCreateWorkspaceMode | null>;
  /** 打开系统原生文件夹选择窗口，并返回用户选择的目录。 */
  pick_directory: (initial_directory: string) => Promise<string | null>;
}
