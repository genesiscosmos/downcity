/** 扩展作者的单入口协议；Agent 定义只提供行为，身份和存储始终由宿主分配。 */
import type { AgentOptions } from "@downcity/agent";
import type { ModelClient } from "@downcity/type";
import type { Federation } from "@downcity/federation";
import type { PowerDefinition } from "../../power/index.js";

/** 请求宿主补齐配置的字段，秘密值不进入普通配置记录。 */
export interface ExtensionConfigurationField {
  /** 当前版本字段稳定键。 */
  name: string;
  /** 一句话用途。 */
  description: string;
  /** 是否经宿主私密存储访问。 */
  secret?: boolean;
}

/** 可复用 Agent 行为定义，支持创建多个宿主身份。 */
export interface ExtensionAgentDefinition {
  /** 项目内稳定定义 ID。 */
  id: string;
  /** 定义的展示名。 */
  name: string;
  /** 创建界面可展示的短说明。 */
  description?: string;
  /** 行为配置；不允许覆盖宿主 ID、存储与 Workspace。 */
  behavior: Pick<AgentOptions, "instruction" | "tools" | "hooks" | "session_class" | "session_composer" | "model">;
}

/** 标准 Federation 的稳定条目身份由作者实例提供。 */
export type ExtensionFederation = Federation;

/** Power 与其浏览器源码的唯一绑定，不需要额外清单或独立资源注册。 */
export interface ExtensionPowerDefinition extends PowerDefinition {
  /** 项目内浏览器入口与 UI 插槽；宿主独立编译，CLI 不执行浏览器代码。 */
  readonly renderer?: {
    /** 浏览器源码相对于项目根的路径。 */
    entry: string;
    /** 是否提供工作页面。 */
    mainview?: boolean;
    /** 是否提供侧栏。 */
    sidebar?: boolean;
    /** 是否提供配置界面。 */
    config?: boolean;
  };
}

/** 单入口的全部导出；不存在逐项注册旁路。 */
export interface ExtensionProject {
  /** 原始 Power 实例，宿主使用薄适配分配稳定命名空间。 */
  powers?: readonly ExtensionPowerDefinition[];
  /** 可创建的 Agent 行为，不自动实例化。 */
  agents?: readonly ExtensionAgentDefinition[];
  /** 标准文本模型实例；必须声明有效上下文容量。 */
  models?: readonly ModelClient[];
  /** 标准连接实例；不自动切换登录或对外监听。 */
  federations?: readonly ExtensionFederation[];
}

/** 项目执行能获取的最小上下文，不暴露账户库或宿主数据库。 */
export interface ExtensionContext {
  /** 当前稳定项目身份。 */
  extension_id: string;
  /** 本次快照绑定的普通配置。 */
  config: Readonly<Record<string, unknown>>;
  /** 跨重新加载保留的项目数据路径。 */
  data_path: string;
  /** 加载阶段取消信号。 */
  signal: AbortSignal;
  /** 读取本项目当前快照绑定的秘密版本。 */
  secrets: { /** 读取当前项目及快照绑定的秘密值。 */ get: (name: string) => Promise<string | undefined> };
  /** 声明一次结构化配置需求。 */
  require_configuration: (fields: readonly ExtensionConfigurationField[]) => never;
  /** 登记普通资源的逆序清理回调，资源键避免重复清理 SDK 资源。 */
  on_dispose: (callback: () => void | Promise<void>, resource?: object) => void;
}

/** 唯一默认导出可以是能力对象或返回该对象的函数。 */
export type ExtensionEntry = ExtensionProject | ((context: ExtensionContext) => ExtensionProject | Promise<ExtensionProject>);
