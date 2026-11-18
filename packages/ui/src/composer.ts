/** 无 React 运行时的文档转换入口，供服务端与 Electron Main 和编辑器共享序列化规则。 */
export { project_chat_composer } from "./lib/chat-document-projection";
export { chat_composer_code_fence_line, parse_fenced_paste, read_chat_composer_code_fence, read_chat_composer_code_language, serialize_chat_composer_code_block } from "./lib/chat-document-code-fence";
export type { ChatComposerTextPart, ChatComposerContextPart, ChatComposerFilePart, ChatComposerDataPart, ChatComposerPart, ChatComposerProjectionOptions } from "./types/chat-document";
export { create_chat_composer, is_chat_composer_empty, is_chat_composer_node_empty, read_chat_composer_text, read_chat_composer_visible_text, has_chat_composer_atoms, has_chat_composer_rich_formatting, count_chat_composer_atoms } from "./components/chat-input/chatComposerCodec";
export { should_restore_editor_draft } from "./components/chat-input/draftSync";
export { is_current_editor_async_target } from "./components/chat-input/editor_async_target";
export { is_plain_enter, is_single_plain_text_paragraph, resolve_chat_composer_enter_action } from "./components/chat-input/chatComposerKeymap";
export { read_reference_payload, reference_payload, copy_chat_reference } from "./components/chat-input/chatReferenceClipboard";
export { local_file_reference_tag, read_local_file_reference, local_file_reference_node } from "./components/chat-input/local_file_reference";
export type { LocalFileReference } from "./components/chat-input/local_file_reference";
export { is_chat_reference_tag } from "./components/chat-input/session-reference";
export type { ChatInputProps, ChatInputHost, ChatInputMember, ChatInputFile, ChatInputWorkspaceFile, ChatInputSubmitMode, ComposerAttachments, ComposerEditMode, ChatReferenceInput, ChatReferenceNodeAttributes, ChatAttachmentNodeAttributes, ChatDataNodeAttributes, ChatSlashCommand } from "./types/chat-input";

export type { EditorAsyncTarget } from "./components/chat-input/editor_async_target";
