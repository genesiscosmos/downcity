/** 模型控件展示协议；价格、推理与能力字段复用共享 City 目录类型。 */
import type { CityModelDescriptor, SessionApprovalMode } from "@downcity/type";
import type { ReactNode } from "react";
import type { ChatControlMessages } from "./chat-controls";

/** 宿主模型目录的轻量投影；可从 CityModelDescriptor 的 id 映射 model_id。 */
export interface ModelSummary extends Pick<CityModelDescriptor, "name" | "description" | "modalities" | "context_window" | "tags" | "reasoning"> {
  /** 宿主执行模型请求时使用的稳定 ID。 */ model_id: string;
  /** 一个或多个共享协议价格方案。 */ pricing?: CityModelDescriptor["pricing"];
}
/** 模型与推理设置，只包含菜单真正需要的配置。 */
export interface ModelConfiguration {
  /** 当前模型 ID，空串表示尚未选择。 */ model_id: string;
  /** 当前显式推理档位；省略时由模型使用默认值。 */ reasoning_effort?: string;
}
/** 单个模型每百万 token 的美元单价。 */
export interface ModelPricingPoint {
  /** 稳定模型标识。 */ model_id: string;
  /** 面向用户的模型名称。 */ model_name: string;
  /** 每百万输入 token 的美元价格。 */ input_usd_per_1m: number;
  /** 每百万输出 token 的美元价格。 */ output_usd_per_1m: number;
}
/** 品牌识别图标。 */
export interface LLMModelIconProps {
  /** 稳定模型标识，支持 provider/model 与 provider:model。 */ model_id: string;
  /** 名称补充品牌识别。 */ model_name?: string;
  /** 标签补充品牌识别。 */ tags?: readonly string[];
  /** 图标尺寸类名。 */ size_class?: string;
}
/** 表单模型选择器。 */
export interface ModelSelectorProps extends ChatControlMessages {
  /** 当前模型 ID。 */ current_model_id: string;
  /** 当前显式推理档位 ID；省略时使用模型默认值，仅展示当前模型声明支持的档位。 */ reasoning_effort?: string;
  /** 宿主提供的模型目录，表单不限制模型能力。 */ models: readonly ModelSummary[];
  /** 目录是否正在加载。 */ loading?: boolean;
  /** 空目录提示。 */ empty_text?: string;
  /** 尚未选择时的触发器文字。 */ trigger_label?: string;
  /** 提交选择，由宿主保存并处理异常。 */ on_select_model(model_id: string): void | Promise<void>;
  /** 可选推理保存回调，支持同步或异步；提供后仅在当前模型声明可用档位时显示强度子菜单。参数为档位 ID，undefined 表示使用模型默认值；宿主负责保存、异常处理及切换模型后的档位重置。 */ on_select_reasoning_effort?(reasoning_effort?: string): void | Promise<void>;
  /** 浮层对齐方向。 */ align?: "start" | "center" | "end";
  /** 浮层优先方向。 */ side?: "top" | "right" | "bottom" | "left";
  /** 触发按钮附加类名。 */ class_name?: string;
  /** 单行高度分别为 24、32、40px。 */ control_size?: "compact" | "default" | "large";
}
/** 聊天模型与推理菜单。 */
export interface ChatModelSelectorProps extends ChatControlMessages {
  /** 当前实际模型与推理配置。 */ configuration: ModelConfiguration;
  /** 模型目录，聊天自动筛选文字模型。 */ models: readonly ModelSummary[];
  /** 目录加载状态。 */ models_loading: boolean;
  /** 保存模型选择，由宿主处理异常。 */ set_model(model_id: string): Promise<void>;
  /** 可选推理保存能力；没有提供时不显示推理菜单。 */ set_reasoning_effort?(reasoning_effort?: string): Promise<void>;
}
/** 可独用的目录搜索与选择列表。 */
export interface ModelOptionsProps extends ChatControlMessages {
  /** 展示候选，不改变宿主数组。 */ models: readonly ModelSummary[];
  /** 当前选中 ID。 */ current_model_id: string;
  /** 目录是否加载中。 */ loading: boolean;
  /** 选择候选。 */ on_select(model_id: string): void | Promise<void>;
  /** 自定义空结果文案。 */ empty_text?: string;
  /** menu 使用聊天目录行；field 使用表单紧凑行，搜索与详情能力保持一致。 */ variant?: "menu" | "field";
}
/** 详情与推理子菜单的入口。 */
export interface SelectorSubmenuProps {
  /** 分类名称。 */ label: string;
  /** 当前显示值。 */ value: string;
  /** 展开内容。 */ children: ReactNode;
}
/** 可独用的推理档位列表。 */
export interface ReasoningOptionsProps extends ChatControlMessages {
  /** 模型声明的可用档位，顺序保持不变。 */ efforts: NonNullable<CityModelDescriptor["reasoning"]>["efforts"];
  /** 当前显式档位；省略表示自动。 */ selected_effort?: string;
  /** 保存选择，undefined 表示自动。 */ on_select(reasoning_effort?: string): Promise<void>;
}
/** 审批模式选择器。 */
export interface ChatApprovalModeSelectorProps extends ChatControlMessages {
  /** 宿主当前配置，未提供时禁用选择。 */ configuration?: {
    /** 当前共享 Session 审批模式。 */ approval_mode: SessionApprovalMode;
  };
  /** 保存审批模式，由宿主处理异常。 */ set_approval_mode(approval_mode: SessionApprovalMode): Promise<void>;
}
/** SVG 输入输出价格对比图。 */
export interface ModelPricingChartProps extends ChatControlMessages {
  /** 每百万 token 的美元价格数据。 */ data: readonly ModelPricingPoint[];
  /** 数字格式化使用的 locale，默认跟随浏览器。 */ locale?: string;
}

/** 独立模型详情。 */
export interface ModelDetailsProps extends ChatControlMessages {
  /** 共享目录投影中的模型信息。 */ model: ModelSummary;
}

/** 详情卡内的单个字段。 */
export interface ModelDetailProps {
  /** 面向用户的字段名称。 */ label: string;
  /** 已格式化的字段内容。 */ value: string;
}
