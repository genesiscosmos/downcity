/** 富文本输入的可移植展示与宿主能力契约。 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

/** 输入栏专用按钮；显式尺寸与主操作意图不依赖通用按钮默认值。 */
export interface ChatInputButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 默认透明操作或发送/停止主操作。 */ variant?: "default" | "primary";
  /** 图标为 24px 正方形，文字按钮保持相同高度。 */ size?: "default" | "icon";
}
import type { JSONContent } from "@tiptap/core";
import type { JsonValue } from "./chat-document";
/** 提交意图由宿主 Session 决定排队策略。 */
export type ChatInputSubmitMode = "send" | "queue" | "steer";
/** 编辑器只读取成员身份，不持有 Agent 运行实例。 */
export interface ChatInputMember {
  /** 稳定成员标识。 */ agent_id: string;
  /** 用于候选与标签的用户可见名称。 */ name: string;
  /** 可选头像地址。 */ avatar_url?: string;
}
/** 可加入文档的文件内容。 */
export interface ChatInputFile {
  /** 原始文件名。 */ filename: string;
  /** IANA MIME 类型。 */ media_type: string;
  /** 文件内容的 Data URL。 */ data_url: string;
}
/** 宿主提供的可引用文件摘要。 */
export interface ChatInputWorkspaceFile {
  /** 工作区中的相对路径。 */ relative_path: string;
  /** 原始文件名。 */ filename: string;
  /** 最近修改时间，毫秒时间戳。 */ modified_at: number;
}
/** 宿主可注入的节点展示与外部输入通道；SDK 管理所有编辑事务与订阅清理。 */
export interface ChatInputHost {
  /** 翻译 SDK 输入文案；key 为 composer.*、message.* 或 queue.*。 */
  translate?(key: string, values?: Record<string, string | number>): string;
  /** 渲染候选及负责人标签头像。 */
  render_avatar?(member: ChatInputMember, class_name: string): ReactNode;
  /** 渲染附件预览；移除操作由编辑器拥有。 */
  render_attachment?(attachment: ChatAttachmentNodeAttributes, remove?: () => void): ReactNode;
  /** 渲染引用预览；引用快照仍保存在文档中。 */
  render_reference?(reference: ChatReferenceNodeAttributes, remove?: () => void): ReactNode;
  /** 订阅当前输入目标的引用；返回解除订阅函数。 */
  subscribe_reference?(listener: (reference: ChatReferenceInput) => void): () => void;
  /** 订阅外部成员提及；返回解除订阅函数。 */
  subscribe_mention?(listener: (member: ChatInputMember) => void): () => void;
  /** 向宿主登记定向引用插入能力；返回注销函数。 */
  register_reference_target?(editor_key: string, insert: (reference: ChatReferenceInput) => boolean): () => void;
  /** 向宿主登记待保存草稿的同步出口；返回注销函数。 */
  register_draft_sync?(editor_key: string, flush: () => void): () => void;
}

/** 编辑器内一个附件原子节点的属性。 */
export interface ChatAttachmentNodeAttributes extends ChatInputFile {
  /** 节点在一份草稿中的稳定标识。 */
  attachment_id: string;
}

/** 编辑器内一个引用原子节点的属性。 */
export interface ChatReferenceNodeAttributes {
  /** 任务来源标题，展示时与完整引用正文分开保存。 */
  source_title?: string;
  /** 任务稳定身份，用于区分不同任务交付。 */
  task_id?: string;
  /** 当前引用对应的执行记录时间戳。 */
  run_timestamp?: string;
  /** 消息引用对应的 canonical 消息标识；文件引用不设置。 */
  message_id?: string;
  /** 消息引用在对话中的身份；文件引用不设置。 */
  role?: "user" | "agent";
  /** 文件引用所属的工作区标识；消息引用不设置。 */
  workspace_id?: string;
  /** 文件引用在工作区内的相对路径；消息引用不设置。 */
  relative_path?: string;
  /** 源码选区起始的 1 基行号；渲染预览不设置。 */
  line_start?: number;
  /** 源码选区结束的 1 基行号；渲染预览不设置。 */
  line_end?: number;
  /** Context part 原始语义标签。 */
  tag: string;
  /** 提交时冻结并写入 Session Context Part 的可读文本。 */
  text: string;
  /** 引用胶囊展示的简短文本。 */
  preview_text: string;
}

/** 编辑器内结构化数据原子节点的属性。 */
export interface ChatDataNodeAttributes {
  /** 结构化数据的业务类型。 */
  data_type: string;
  /** canonical JSON 数据。 */
  data: JsonValue;
  /** 可选稳定数据标识。 */
  data_id: string;
}

/** 消息或文件选区向 Chat Composer 插入引用时携带的内容。 */
export type ChatReferenceInput = Omit<ChatReferenceNodeAttributes, "preview_text" | "tag"> & {
  /** Context part 的语义标签；省略时使用消息引用的默认标签。 */
  tag?: string;
};

/** 可由 Slash 菜单执行的一条命令。 */
export interface ChatSlashCommand {
  /** 命令在当前菜单中的稳定标识。 */
  command_id: string;
  /** 菜单主标题。 */
  title: string;
  /** 帮助用户判断用途的简短说明。 */
  description: string;
  /** 用于匹配 Slash 查询的额外关键词。 */
  keywords: string[];
  /** 删除 Slash 查询后执行命令。 */
  run(): void | Promise<void>;
}

/** 当前工作区为编辑器提供的附件读取能力。 */
export interface ComposerAttachments {
  /** 列出当前工作区中可引用的文件。 */
  list_files(): Promise<ChatInputWorkspaceFile[]>;
  /** 读取用户选中的文件并返回可提交的附件内容。 */
  read_file(relative_path: string): Promise<ChatInputFile>;
}

/** 在 ChatInput 中确认修改的编辑模式；提交只更新所属业务文档。 */
export interface ComposerEditMode {
  /** 编辑输入区的辅助技术名称，通过背景色呈现可见状态，不占据顶部空间。 */
  aria_label: string;
  /** 确认按钮的可见文字及可访问名称。 */
  confirm_label: string;
  /** 取消编辑并恢复所属场景的原草稿。 */
  cancel(): void;
}

/** 富文本编辑器需要的文档、交互与可组合界面。 */
export interface ChatInputProps {
  /** 可选宿主展示、翻译与事件绑定；省略时使用 SDK 默认界面。 */
  host?: ChatInputHost;
  /** 单个上传文件的字节上限，默认 20 MiB。 */
  max_attachment_bytes?: number;
  /** 只读展示当前文档；默认允许编辑，不影响常规聊天运行时继续输入。 */
  read_only?: boolean;
  /** 场景尚未满足提交条件；按钮与键盘提交共用此状态，不阻止继续编辑。 */
  submit_disabled?: boolean;
  /** 提交时是否清空文档，默认清空；草稿生成等需要保留原文的场景设为 false。 */
  clear_on_submit?: boolean;
  /** 是否提供聊天斜杠命令，默认开启；独立文本生成入口可关闭。 */
  slash_commands_enabled?: boolean;
  /** 轻量输入表面，隐藏聊天菜单与工具栏，保留共用 Tiptap 编辑能力。 */
  compact?: boolean;
  /** 任务列表原位样式：单行起始、向下候选、按内容显示提交操作。 */
  task_inline?: boolean;
  /** 轻量表面的主操作文案；标准聊天外观用作发送按钮的可访问名称与提示。 */
  submit_label?: string;
  /** 输入为空时的可选确认操作；用于确认已经生成的草稿。 */
  confirm_empty?: () => Promise<void>;
  /** 空输入确认是否可用，存在未解决问题时关闭。 */
  can_confirm_empty?: boolean;
  /** 输入所属的稳定标识，切换时保存原输入并恢复目标草稿。 */
  editor_key: string;
  /** 草稿必须明确选择唯一负责人；没有有效标签时自动展示这些候选并阻止发送，与群聊提及互斥。 */
  agent_recipients?: ChatInputMember[];
  /** 当前结构化草稿，外部变更会同步到编辑器。 */
  draft_content: JSONContent;
  /** 普通草稿与编辑事务的实例隔离键，切换时先保存旧实例未同步的内容。 */
  draft_scope?: string;
  /** 替换发送入口的编辑确认模式；不改变输入所属会话和侧栏标签标识。 */
  edit_mode?: ComposerEditMode;
  /** 尚未处理的聚焦请求序号；大于 0 且与已处理序号不同时，编辑器挂载后获得键盘焦点。 */
  focus_request?: number;
  /** 空输入时的占位提示。 */
  placeholder: string;
  /** 当前对话是否正在执行，用于提交和停止交互。 */
  busy: boolean;
  /** Main 正在等待当前 Turn 停止，期间保留草稿并防止重复停止或提交。 */
  stopping?: boolean;
  /** 当前是否已有待发送队列，用于准确呈现常规提交的去向。 */
  has_pending_queue?: boolean;
  /** 当前场景是否支持创建暂停队列。 */
  can_queue?: boolean;
  /** 是否启用浏览器拼写检查。 */
  spellcheck_enabled: boolean;
  /** 保存当前输入文档。 */
  update_draft(input: JSONContent): void;
  /** 按常规策略提交，或在 steer 模式下绕过队列立即提交。 */
  send_message(input: JSONContent, mode?: ChatInputSubmitMode): Promise<void>;
  /** 停止执行；草稿场景不提供此能力。 */
  stop_session?(): Promise<void>;
  /** 工作区附件能力；不支持附件的场景不提供。 */
  attachments?: ComposerAttachments;
  /** 可通过 @ 引用的成员，未提供时关闭成员选择。 */
  members?: ChatInputMember[];
  /** 用户从 @ 候选中明确选择成员后通知所属场景。 */
  on_select_member?(member: ChatInputMember): void;
  /**
   * 草稿中 @ 负责人发生变化（选择、替换或删除）时立即通知。
   *
   * 参数是当前文档中的负责人；没有标记时为空，表示等待用户重新选择。
   * 草案的负责人就是这段输入的接收方，因此变化必须同步上报，
   * 不能等草稿防抖写回后才被发现——那会留下「已删除标记但仍用旧负责人」的窗口。
   */
  on_recipient_change?(agent_id: string | undefined): void;
  /** 所属聊天场景提供的额外斜杠命令。 */
  commands?: ChatSlashCommand[];
  /** 输入工具栏，由场景组合模型、审批等控制项。 */
  toolbar?: ReactNode;
  /** 发送按钮左侧的展开/收起入口，由场景决定打开或关闭哪个面板。 */
  expand?: ReactNode;
  /**
   * `expand` 入口的显示时机。
   *
   * 正文里用 `when-non-empty`：空输入框展开没有好处，常驻一个图标只是噪声。
   * 面板里用 `always`：那里的收起入口是退出面板的唯一可见入口，不能随内容一起消失。
   */
  expand_visibility?: "when-non-empty" | "always";
  /**
   * 是否以多行书写为主（展开在右侧面板时）。
   *
   * 开启后裸 Enter 只换行，提交必须用修饰键——大输入区的意义就是写长内容。
   */
  multiline_enter?: boolean;
  /**
   * 挂载后是否直接把键盘焦点交给输入框。
   *
   * 展开到面板时开启：用户点展开就是为了打字，进来还要再点一下才能输入是多余的。
   * 正文里的输入框不开：那是页面的一部分，抢焦点会打断用户正在做的其它事。
   */
  auto_focus_on_mount?: boolean;
}
