/**
 * Downcity UI SDK 导出入口。
 *
 * 关键说明（中文）
 * - 默认导出可复用的基础 UI 原语。
 * - 少量经过抽象的复合组件也会在这里公开，例如 workboard。
 * - `styles.css` 作为独立样式入口，由宿主应用按需引入。
 */

export { cn } from "./lib/utils";
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
  DowncityChatThread,
} from "./types/chat";
export { ChatComposer, ChatHistory, ChatMessage, ChatMessageList, ChatPanel } from "./components/chat";
export { session_jsonl_to_chat_messages, session_message_to_chat_message, session_part_to_chat_part } from "./lib/session-message";
export { DowncityChatRuntime, create_chat_runtime } from "./lib/chat-runtime";
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
