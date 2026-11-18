/** @ 候选菜单：草稿负责人和 Workspace 文件共用候选范围，选择语义由调用方提供。 */
import type { RefObject } from "react";
import { TbPaperclip } from "./input-icons";
import { InputAvatar as AgentAvatar } from "./host";
import type { ChatInputMember, ChatInputWorkspaceFile } from "../../types/chat-input";
import { use_chat_input_host } from "./host";

/** 编辑器候选菜单的展示与选择能力。 */
interface ComposerMentionMenuProps {
  /** 用于将键盘选中的候选滚动到视区。 */
  menu_ref: RefObject<HTMLDivElement | null>;
  /** 可明确选择的 Agent 候选。 */
  agents: ChatInputMember[];
  /** 与 Agent 候选共用键盘索引的文件候选。 */
  files: ChatInputWorkspaceFile[];
  /** 新建页自动展开时只提供 Agent，使用对应的菜单名称与空态文案。 */
  agent_only?: boolean;
  /** 当前选中项，先排列 Agent，再排列文件。 */
  selected_index: number;
  /** 指针悬停时同步键盘索引。 */
  set_index(index: number): void;
  /** 选择一名 Agent；草稿替换负责人，群聊插入成员提及。 */
  select_agent(agent: ChatInputMember): void;
  /** 将指定 Workspace 文件作为附件加入输入。 */
  select_file(file: ChatInputWorkspaceFile): void;
}

/** 支持鼠标及由编辑器统一处理的方向键、Enter 和 IME 交互。 */
export function ComposerMentionMenu(props: ComposerMentionMenuProps) {
  const translate = use_chat_input_host().translate;
  const row_class_name = (index: number) => `flex w-full items-center gap-2 rounded-chip px-2 py-1.5 text-left text-xs outline-none hover:bg-interaction-hover focus-visible:bg-interaction-hover ${index === props.selected_index ? "bg-interaction-selected" : ""}`;
  return <div className="chat-composer-candidate-menu absolute bottom-full left-1 z-30 mb-2 w-72 overflow-hidden rounded-surface border border-border bg-background p-1 text-popover-foreground outline-none">
    <div ref={props.menu_ref} role="listbox" aria-label={translate(props.agent_only ? "composer.choose_agent" : "composer.mention_candidates")} className="max-h-64 overflow-y-auto">
    {!props.agents.length && !props.files.length ? <p role="status" className="px-3 py-2 text-xs text-muted-foreground">{translate(props.agent_only ? "composer.no_agent_match" : "composer.no_mention_match")}</p> : null}
    {props.agents.map((agent, index) => <button key={agent.agent_id} type="button" role="option" aria-selected={index === props.selected_index} onMouseEnter={() => props.set_index(index)} className={row_class_name(index)} onMouseDown={event => event.preventDefault()} onClick={() => props.select_agent(agent)}>
      <AgentAvatar agent={agent} class_name="size-5" /><span className="min-w-0 flex-1 truncate">@{agent.name}</span>
    </button>)}
    {props.files.map((file, file_index) => {
      const index = props.agents.length + file_index;
      return <button key={file.relative_path} type="button" role="option" aria-selected={index === props.selected_index} onMouseEnter={() => props.set_index(index)} className={row_class_name(index)} onMouseDown={event => event.preventDefault()} onClick={() => props.select_file(file)}>
        <TbPaperclip className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{file.relative_path}</span>
      </button>;
    })}
    </div>
  </div>;
}
