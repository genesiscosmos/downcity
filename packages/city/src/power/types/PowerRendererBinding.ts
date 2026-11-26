/** 跨宿主 Renderer 静态声明；具体运行时、展示能力和编译由协议适配器负责。 */
import type { JsonValue } from "@downcity/type";

/** 一个完整版本的宿主协议入口，不持有可执行模块或后端实例。 */
export interface PowerRendererBinding {
  /** 相对扩展源码根或预构建包根的入口文件；未知协议不限制文件后缀。 */
  readonly entry: string;
  /** 协议定义的 JSON 元数据；通用层不套用 Desktop 的插槽规则。 */
  readonly capabilities?: Readonly<Record<string, JsonValue>>;
  /** 预构建包需复制的额外运行文件，相对包根逐文件声明，包含分块、样式和资产。 */
  readonly resources?: readonly string[];
}

/** 键为完整协议 ID（含版本），每个协议只声明一个入口。 */
export type PowerRendererBindings = Readonly<Record<string, PowerRendererBinding>>;

/** 宿主按自身支持顺序选中的唯一协议和静态声明。 */
export interface PowerRendererSelection {
  /** 精确匹配的协议 ID，不进行版本推断或模糊回退。 */
  readonly protocol_id: string;
  /** 该协议对应的入口和元数据。 */
  readonly binding: PowerRendererBinding;
}
