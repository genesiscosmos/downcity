/** 共享协议交互表单的展示和提交属性。 */
import type { RespondSessionInteractionInput, SessionAgentInteraction, SessionInteractionQuestion } from "@downcity/type";
import type { ChatControlMessages } from "./chat-controls";
/** 表单的展示上下文；只影响排版和重复标题，不改变 canonical 交互行为。 */
export interface InteractionPresentation {
  /** chat 保留紧凑聊天表单；inbox 使用独立页面的间距和字号。 */
  presentation?: "chat" | "inbox";
  /** 宿主已经展示的标题；表单省略相同标题时仍关联该标题供辅助技术读取。 */
  external_heading?: {
    /** 宿主标题元素的稳定 DOM 标识。 */
    title_id: string;
    /** 宿主已显示的标题文字，用于判断当前问题是否需要单独展示。 */
    title: string;
  };
}


/** 完整交互表单，既可展示待处理表单，也可只读展示结果。 */
export interface AgentInteractionProps extends InteractionPresentation, ChatControlMessages {
  /** canonical 交互快照。 */ part: SessionAgentInteraction;
  /** 私密问题通过额外标记交给宿主选择提交入口。 */ respond(input: RespondSessionInteractionInput, private_question?: boolean): Promise<void>;
  /** 强制显示结果摘要，不呈现编辑表单。 */ read_only?: boolean;
  /** 普通问题的输入提示；私密输入不使用该提示。 */ answer_placeholder?: string;
}

/** 单个问题的可控输入字段。 */
export interface QuestionFieldProps {
  /** 普通文字提示，不用于私密字段。 */ placeholder?: string;
  /** 共享问题定义。 */ question: SessionInteractionQuestion;
  /** 当前回答，多选使用数组。 */ value?: string | string[];
  /** 提交期间禁止修改。 */ disabled: boolean;
  /** 对应问题提示的 DOM 标识。 */ labelled_by: string;
  /** 向表单拥有者回传回答。 */ set_value(value: string | string[]): void;
}

/** 问题表单可选的补充说明输入。 */
export interface InteractionNoteProps {
  /** 当前说明，不用于私密问题。 */ value: string;
  /** 提交期间禁止编辑。 */ disabled: boolean;
  /** 更新说明。 */ set_value(value: string): void;
}
