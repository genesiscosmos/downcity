/** 模型菜单、状态面板和交互表单共用的宿主文案契约。 */
import type { ReactNode } from "react";
export type ChatControlTranslate = (key: string, values?: Record<string, string | number>) => string;

/** 所有独用组件均可传入文案；组合组件向内部组件传递同一翻译函数。 */
export interface ChatControlMessages {
  /** 使用 chat:、common: 命名空间的文案解析器；省略时使用内置英文。 */
  translate?: ChatControlTranslate;
}

/** 组合控件的实例级文案边界。 */
export interface ControlMessagesProviderProps extends ChatControlMessages {
  /** 使用同一文案解析器的内容。 */ children: ReactNode;
}
