/**
 * Downcity UI SDK 导出入口。
 *
 * 关键说明（中文）
 * - 默认导出可复用的基础 UI 原语。
 * - 少量经过抽象的复合组件也会在这里公开，例如 workboard。
 * - `styles.css` 作为独立样式入口，由宿主应用按需引入。
 */

export { cn } from "./lib/utils";
export { Activity } from "./components/activity";
export { ActivityItem } from "./components/activity-item";
export { ActivityHeader } from "./components/activity-header";
export { ActivityDetailPanel } from "./components/activity-detail-panel";
export type { ActivityProps, ActivityItemProps, ActivityHeaderProps, ActivityDetailPanelProps } from "./types/activity-components";
export { ModelSelector } from "./components/model/ModelSelector";
export { ChatModelSelector, ModelDetails, ModelOptions, ReasoningOptions, SelectorSubmenu } from "./components/model/ChatModelSelector";
export { ChatApprovalModeSelector } from "./components/model/ChatApprovalModeSelector";
export { LLMModelIcon } from "./components/model/LLMModelIcon";
export { ModelPricingChart } from "./components/model/ModelPricingChart";
export { format_token_count, format_usd_price, format_credit_amount, format_compact_number } from "./lib/model/model_format";
export { build_model_pricing } from "./lib/model/model_pricing";
export { format_model_reasoning, format_default_model_reasoning, get_default_model_reasoning } from "./lib/model/model_reasoning";
export { is_text_model } from "./lib/model/model_selection";
export { StatusPanel } from "./components/status-panel/StatusPanel";
export { StatusPanelHeader } from "./components/status-panel/StatusPanelHeader";
export { StatusPanelButton } from "./components/status-panel/status-panel-button";
export type { StatusPanelButtonProps } from "./types/status-panel-button";
export { MessageQueue } from "./components/status-panel/MessageQueue";
export { QueuedMessageResources } from "./components/status-panel/QueuedMessageResources";
export { PendingInteractionArea } from "./components/status-panel/PendingInteractionArea";
export { AgentInteraction, ApprovalInteractionCard, QuestionInteractionCard, QuestionField, resolve_agent_interaction_title } from "./components/status-panel/AgentInteraction";
export { ShellList } from "./components/status-panel/ShellList";
export { SubSessionList } from "./components/status-panel/SubSessionList";
export { SubSessionStatusIcon } from "./components/status-panel/SubSessionStatusIcon";
export { PillSwitcher } from "./components/pill-switcher";
export type { ChatControlTranslate, ChatControlMessages } from "./types/chat-controls";
export type { ModelSummary, ModelDisplayPreferences, ModelDetailsProps, ModelConfiguration, ModelPricingPoint, LLMModelIconProps, ModelSelectorProps, ChatModelSelectorProps, ModelOptionsProps, ReasoningOptionsProps, SelectorSubmenuProps, ChatApprovalModeSelectorProps, ModelPricingChartProps } from "./types/model-controls";
export type { StatusPanelShellItem, ShellListProps, StatusPanelProps, QueuedMessageResourcesProps, StatusPanelHeaderProps, MessageQueueProps, QueuedChatMessage, PendingInteractionItem, PendingInteractionAreaProps, SubSessionItem, SubSessionListProps, SubSessionStatus, SubSessionStatusIconProps } from "./types/status-panel";
export type { AgentInteractionProps, InteractionPresentation, QuestionFieldProps } from "./types/agent-interaction";
export type { PillSwitcherOption, PillSwitcherProps } from "./types/pill-switcher";
export { MarkdownView } from "./components/markdown/MarkdownView";
export { MarkdownViewProvider, use_markdown_text_size } from "./components/markdown/markdown_host_context";
export { MarkdownExportContext } from "./components/markdown/markdown_export_context";
export { get_markdown_text_size } from "./components/markdown/markdown_text_size";
export type { MarkdownViewTextSize } from "./components/markdown/markdown_text_size";
export type { MarkdownViewProps, MarkdownViewProviderProps } from "./components/markdown/markdown_view_types";
export {
  ShortcutProvider,
  detect_shortcut_platform,
  format_shortcut_display,
  get_shortcut_context,
  list_registered_shortcut_definitions,
  list_registered_shortcuts,
  matches_shortcut,
  normalize_shortcut_key,
  register_shortcuts,
  shortcut_priority_value,
  use_register_shortcuts,
} from "./shortcuts";
export type { ShortcutContext, ShortcutDefinition, ShortcutFocus, ShortcutPlatform, ShortcutPriority, ShortcutScope } from "./shortcuts";
export type {
  DowncityChatAttachment,
  DowncityChatContentPart,
  DowncityChatMessage,
  DowncityChatMessagePart,
  DowncityChatMessagePartType,
  DowncityChatMessageRenderProps,
  DowncityChatQuestion,
  DowncityChatQuestionOption,
  DowncityChatOperation,
  DowncityChatChangedFile,
  DowncityChatChangedFileSummary,
  DowncityChatModelOption,
  DowncityChatApprovalMode,
  DowncityChatMessageRole,
  DowncityChatPanelProps,
  DowncityChatStatus,
  DowncityChatSubmitInput,
  DowncityChatSubmitMode,
  DowncityChatThread,
} from "./types/chat";
export type { DowncityChatInputContent, DowncityChatInputPart, DowncityChatInputSource } from "./types/chat-runtime-input";
export { ChatComposer, ChatHistory, ChatMessage, ChatMessageList, ChatPanel } from "./components/chat";
export { session_jsonl_to_chat_messages, session_message_to_chat_message, session_part_to_chat_part } from "./lib/session-message";
export { DowncityChatRuntime, create_chat_runtime } from "./lib/chat-runtime";
export { is_single_plain_text_paragraph, resolve_chat_composer_enter_action } from "./lib/chat-composer-keymap";
export type { DowncityChatComposerEnterAction, DowncityChatComposerEnterContext, DowncityChatComposerEnterKey } from "./lib/chat-composer-keymap";
export { build_chat_composer_newline_commands, ChatComposerNewline } from "./lib/chat-composer-newline";
export type { DowncityChatComposerNewlineCommands } from "./lib/chat-composer-newline";
export {
  ChatComposerCodeLanguage,
  chat_composer_code_fence_line,
  chat_composer_document_to_text,
  parse_fenced_paste,
  read_chat_composer_code_fence,
  read_chat_composer_code_language,
  serialize_chat_composer_code_block,
} from "./lib/chat-composer-code-fence";
export type { DowncityChatQueuedInput, DowncityChatRuntimeListener, DowncityChatRuntimeOptions, DowncityChatRuntimeSnapshot } from "./types/chat-runtime";
export type {
  DowncityAnnotationProps,
  DowncityAnnotationTone,
  DowncityButtonSize,
  DowncityButtonVariant,
  DowncityCardSize,
  DowncityCodeBlockProps,
  DowncityDefinitionDescriptionProps,
  DowncityDefinitionListProps,
  DowncityDefinitionTermProps,
  DowncityFootnoteItemProps,
  DowncityFootnoteReferenceProps,
  DowncityFootnotesProps,
  DowncityButtonGroupOrientation,
  DowncityButtonGroupProps,
  DowncityCollapsibleSettingGroupProps,
  DowncityFormFieldProps,
  DowncityFileUploadProps,
  DowncityDataTableColumn,
  DowncityDataTableProps,
  DowncityImagePreviewProps,
  DowncityCommandInputProps,
  DowncityContextMenuContentProps,
  DowncityContextMenuItemProps,
  DowncityContextMenuItemVariant,
  DowncityDropdownMenuItemVariant,
  DowncityInfoRowProps,
  DowncityItemMediaVariant,
  DowncityItemSize,
  DowncityItemVariant,
  DowncitySelectContentProps,
  DowncitySelectItemProps,
  DowncitySelectTriggerProps,
  DowncitySelectTriggerSize,
  DowncitySettingGroupProps,
  DowncitySettingListProps,
  DowncitySettingItemProps,
  DowncitySettingSectionProps,
  DowncitySettingsContainerProps,
  DowncitySliderProps,
  DowncitySpinnerSize,
  DowncitySpinnerProps,
  DowncitySidebarLayoutProps,
  DowncityToasterProps,
  DowncityThemeContainerProps,
  DowncityThemeMode,
  DowncityThemeVariant,
  TextareaProps,
  DowncityToggleGroupProps,
  DowncityToggleGroupSize,
  DowncityToggleGroupVariant,
  DowncityTaskListItemProps,
  DowncityTypographyBlockquoteProps,
  DowncityTypographyHeadingProps,
  DowncityTypographyInlineCodeProps,
  DowncityTypographyListItemProps,
  DowncityTypographyOrderedListProps,
  DowncityTypographyParagraphProps,
  DowncityTypographySpanProps,
  DowncityTypographyUnorderedListProps,
} from "./types/components";
export type {
  DowncityWorkboardActivityItem,
  DowncityWorkboardAgentItem,
  DowncityWorkboardAgentSnapshot,
  DowncityWorkboardBoardSnapshot,
  DowncityWorkboardBoardSummary,
  DowncityWorkboardProps,
  DowncityWorkboardSignalItem,
} from "./types/workboard";
export type {
  DowncityWorkboardGameActor,
  DowncityWorkboardGameAreaLabel,
  DowncityWorkboardGameMapConfig,
  DowncityWorkboardGamePointOfInterest,
  DowncityWorkboardGameRoute,
  DowncityWorkboardGameZone,
} from "./types/workboard-game-map";
export type {
  DowncityWorkboardGameAtlasProps,
  DowncityWorkboardGameHudProps,
  DowncityWorkboardGameInspectorProps,
  DowncityWorkboardGameRoomProps,
  DowncityWorkboardHoverTagSetter,
} from "./types/workboard-game-ui";

export { Button, buttonVariants } from "./components/button";
export { ButtonGroup } from "./components/button-group";
export { ThemeContainer } from "./components/theme-container";
export { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./components/accordion";
export { Alert, AlertDescription, AlertTitle } from "./components/alert";
export { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./components/alert-dialog";
export { Avatar, AvatarFallback, AvatarImage } from "./components/avatar";
export { Badge, badgeVariants } from "./components/badge";
export type { BadgeProps } from "./types/badge";
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components/card";
export { Checkbox } from "./components/checkbox";
export { CodeBlock } from "./components/code-block";
export { FormField } from "./components/form-field";
export { DataTable } from "./components/data-table";
export { FileUpload } from "./components/file-upload";
export { HoverCard, HoverCardContent, HoverCardTrigger } from "./components/hover-card";
export { ImagePreview } from "./components/image-preview";
export { MenuEmpty, MenuGroup, MenuLabel, MenuSeparator, MenuSurface } from "./components/menu";
export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "./components/command";
export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./components/context-menu";
export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./components/dialog";
export { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "./components/drawer";
export { Input } from "./components/input";
export { InputGroup, InputGroupAddon, InputGroupInput, InputGroupTextarea } from "./components/input-group";
export {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./components/empty";
export {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  item_variants,
} from "./components/item";
export { Kbd, KbdGroup } from "./components/kbd";
export { Label } from "./components/label";
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./components/dropdown-menu";
export {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/popover";
export { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "./components/pagination";
export { Progress, ProgressIndicator, ProgressLabel, ProgressTrack, ProgressValue } from "./components/progress";
export { RadioGroup, RadioGroupItem } from "./components/radio-group";
export { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/resizable";
export { ScrollArea, ScrollAreaContent, ScrollAreaScrollbar, ScrollAreaViewport } from "./components/scroll-area";
export { Separator } from "./components/separator";
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./components/select";
export {
  CollapsibleSettingGroup,
  InfoRow,
  SettingGroup,
  SettingItem,
  SettingList,
  SettingSection,
  SettingsContainer,
} from "./components/settings";
export { SidebarLayout } from "./components/sidebar";
export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "./components/sheet";
export { Skeleton } from "./components/skeleton";
export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "./components/table";
export { Slider } from "./components/slider";
export { Spinner } from "./components/spinner";
export { Switch } from "./components/switch";
export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants } from "./components/tabs";
export { Textarea } from "./components/textarea";
export { Toaster } from "./components/sonner";
export { Toggle, toggleVariants } from "./components/toggle";
export { ToggleGroup, ToggleGroupItem } from "./components/toggle-group";
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./components/tooltip";
export {
  Anchor,
  Annotation,
  Blockquote,
  DefinitionDescription,
  DefinitionList,
  DefinitionTerm,
  Emphasis,
  FootnoteItem,
  FootnoteReference,
  Footnotes,
  H1,
  H2,
  H3,
  H4,
  H5,
  H6,
  Hr,
  InlineCode,
  Lead,
  ListItem,
  Muted,
  OrderedList,
  Paragraph,
  Small,
  Strong,
  TaskListItem,
  UnorderedList,
} from "./components/typography";
export { Workboard } from "./components/workboard";
export { buildWorkboardGameMapConfig } from "./components/workboard-game-map";

// 消息与富文本输入的可复用表面及其文档协议。
export { AgentChatMessage, AgentWorkMessage, UserMessage, UserMessageBody } from "./components/chat-messages";
export { ChatInput } from "./components/chat-input/ChatInput";
export { create_chat_composer_extensions } from "./components/chat-input/chatComposerExtensions";
export { read_draft_agent_id, select_draft_agent } from "./components/chat-input/draftAgentRecipient";
export * from "./composer";
export type { AgentMessageProps, UserMessageProps, MessageIdentity } from "./types/chat-message";

export * from "./lib/message-layout";

export { connect_chat_session } from "./lib/chat-session";
export type { DowncityChatSession, DowncityChatConnection } from "./types/chat-session";

export { apply_session_mutation, apply_session_mutations, apply_indexed_session_mutations, create_session_message_index, merge_session_snapshot } from "./lib/session-mutation";

export { AgentMessageContent, UserMessageContent } from "./components/chat-message-content";
export type { AgentMessageBlock, AgentActivityPart, AgentMessageContentProps, UserMessageContentProps } from "./types/chat-blocks";

export { build_user_message_preview, split_complete_blocks, user_message_collapse_over_chars, user_message_preview_chars, user_message_parts_text } from "./lib/user-message-preview";
export type { UserMessagePreview } from "./types/user-message-preview";

// 完整消息活动组件及宿主适配契约。
export { AgentActivity, ActivityProvider } from "./components/agent-activity";
export { ActivityRow } from "./components/activity-row";
export { ActivityReadableDetailView } from "./components/activity-readable";
export type { AgentActivityProps } from "./types/agent-activity-props";
export type { ActivityHost } from "./types/activity-host";
export type { ActivityRowProps, ActivityRowSummary } from "./types/activity-row";
export type { AgentActivityPresentation, AgentActivityDetail, AgentActivityTone, AgentActivityDiffStat, AgentActivityEditPair, AgentToolIdentity, AgentToolVisualKind, AgentActivityVisualKind, AgentActionVisualKind } from "./types/activity";
export type { ActivityReadableDetail, ActivityReadableBody, ActivityText, ActivityQuestion } from "./types/activity-readable";
export { resolve_agent_tool_presentation, resolve_agent_action_presentation, resolve_agent_reasoning_presentation, resolve_agent_tool_identity, resolve_chat_power_lookup, chat_power_names, read_streaming_input_values } from "./lib/activity/agent_activity_presentation";

// 已加载消息中待处理交互的无副作用投影，供状态来源适配器复用。
export { message_pending_interactions } from "./components/chat-status";

export { ActivityIcon } from "./components/activity-icon";
export { ActivityDetailBoundary } from "./components/activity-detail-boundary";
export { ActivityErrorContent } from "./components/activity-error-content";
export type { ActivityErrorContentProps } from "./types/activity-error-content";

// 宿主领域适配器复用相同的 canonical 错误与私密引用处理。
export { activity_call_failed, activity_error_original } from "./lib/activity/activity_error";
export { redact_private as redact_activity_private } from "./lib/activity/activity_detail_shared";
