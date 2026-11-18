/** 公开代码围栏 API 与编辑文档转换共用同一实现。 */
export { ChatComposerCodeLanguage } from "../components/chat-input/chatComposerCodeFence";
export { chat_composer_code_fence_line, parse_fenced_paste, read_chat_composer_code_fence, read_chat_composer_code_language, serialize_chat_composer_code_block } from "./chat-document-code-fence";
export { read_chat_composer_text as chat_composer_document_to_text } from "../components/chat-input/chatComposerCodec";
