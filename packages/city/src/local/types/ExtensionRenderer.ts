/** 扩展浏览器编译产物与宿主目录投影；只描述固定代次，不持有 SDK 实例。 */
import type { PowerRendererBindings, PowerRendererSelection } from "../../power/types/PowerRendererBinding.js";

/** 一份受控浏览器编译结果，仅暴露实际输出文件。 */
export interface ExtensionRendererArtifact {
  /** 输出目录绝对路径，由宿主生成。 */
  directory: string;
  /** 浏览器根 ESM 相对于输出目录的路径。 */
  entry: string;
  /** 构建实际输出文件到 SHA-256 的映射，拒绝任意源码或未声明资源。 */
  files: Readonly<Record<string, string>>;
  /** 与根模块一起挂载的 CSS 输出。 */
  styles: readonly string[];
}

/** 活动扩展 Power 目录，初始化完整成功之后才公开。 */
export interface ExtensionPowerView {
  /** 与后台实例及工具名相同的稳定身份。 */
  power_id: string;
  /** 展示标题。 */
  title: string;
  /** 用途说明。 */
  description: string;
  /** 当前实际运行快照代次，旧页面调用必须携带原值。 */
  generation: string;
  /** 稳定项目身份。 */
  extension_id: string;
  /** 原样保留全部协议静态声明，未知协议不编译或执行。 */
  renderers: PowerRendererBindings;
  /** 仅宿主已支持且准备完毕的协议；无匹配时只公开后端。 */
  selected_renderer?: PowerRendererSelection;
  /** 根 ESM 路径，只在 selected_renderer 已准备好时设置。 */
  entry?: string;
  /** CSS 路径，只指向已编译资源。 */
  styles?: readonly string[];
}

/** 编译器全部输入来自受管快照，不解析作者原目录。 */
export interface ExtensionRendererCompileOptions {
  /** 固定快照内的源码根。 */
  source_path: string;
  /** 与该快照和 Power 绑定的独立输出目录。 */
  output_path: string;
  /** 项目内根入口相对路径。 */
  entry: string;
  /** 与 Power/协议/代次绑定的资源根 URL，资产引用不得相对于宿主页面解析。 */
  resource_base_url: string;
  /** 宿主浏览器 SDK 的模块地址。 */
  runtime_modules: Readonly<Record<string, string>>;
}
