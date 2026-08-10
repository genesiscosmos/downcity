/**
 * UI 模板静态 MDX 文档注册表。
 *
 * 所有文档通过静态导入进入构建图，避免运行时动态导入和未知内容执行。
 */

import BadgeDocument from "../content/components/badge.mdx";
import AccordionDocument from "../content/components/accordion.mdx";
import AlertDocument from "../content/components/alert.mdx";
import AlertDialogDocument from "../content/components/alert-dialog.mdx";
import AvatarDocument from "../content/components/avatar.mdx";
import ButtonDocument from "../content/components/button.mdx";
import ButtonGroupDocument from "../content/components/button-group.mdx";
import CardDocument from "../content/components/card.mdx";
import ChatDocument from "../content/components/chat.mdx";
import CheckboxDocument from "../content/components/checkbox.mdx";
import CodeBlockDocument from "../content/components/code-block.mdx";
import CommandDocument from "../content/components/command.mdx";
import ContextMenuDocument from "../content/components/context-menu.mdx";
import DialogDocument from "../content/components/dialog.mdx";
import DataTableDocument from "../content/components/data-table.mdx";
import DrawerDocument from "../content/components/drawer.mdx";
import DropdownMenuDocument from "../content/components/dropdown-menu.mdx";
import EmptyDocument from "../content/components/empty.mdx";
import InputDocument from "../content/components/input.mdx";
import InputGroupDocument from "../content/components/input-group.mdx";
import FormFieldDocument from "../content/components/form-field.mdx";
import FileUploadDocument from "../content/components/file-upload.mdx";
import HoverCardDocument from "../content/components/hover-card.mdx";
import ImagePreviewDocument from "../content/components/image-preview.mdx";
import ItemDocument from "../content/components/item.mdx";
import KbdDocument from "../content/components/kbd.mdx";
import MenuDocument from "../content/components/menu.mdx";
import PopoverDocument from "../content/components/popover.mdx";
import PaginationDocument from "../content/components/pagination.mdx";
import ProgressDocument from "../content/components/progress.mdx";
import RadioGroupDocument from "../content/components/radio-group.mdx";
import ResizableDocument from "../content/components/resizable.mdx";
import ScrollAreaDocument from "../content/components/scroll-area.mdx";
import SelectDocument from "../content/components/select.mdx";
import SeparatorDocument from "../content/components/separator.mdx";
import SettingsDocument from "../content/components/settings.mdx";
import SheetDocument from "../content/components/sheet.mdx";
import SkeletonDocument from "../content/components/skeleton.mdx";
import SidebarLayoutDocument from "../content/components/sidebar-layout.mdx";
import SliderDocument from "../content/components/slider.mdx";
import SpinnerDocument from "../content/components/spinner.mdx";
import SwitchDocument from "../content/components/switch.mdx";
import TabsDocument from "../content/components/tabs.mdx";
import TableDocument from "../content/components/table.mdx";
import TextareaDocument from "../content/components/textarea.mdx";
import TypographyDocument from "../content/components/typography.mdx";
import ToasterDocument from "../content/components/toaster.mdx";
import ToggleDocument from "../content/components/toggle.mdx";
import TooltipDocument from "../content/components/tooltip.mdx";
import WorkboardDocument from "../content/components/workboard.mdx";
import type { ShowcaseComponentId } from "../types/components.js";
import type { MdxDocumentComponent } from "../types/mdx.js";

export const mdx_document_registry: Record<ShowcaseComponentId, MdxDocumentComponent> = {
  accordion: AccordionDocument,
  alert: AlertDocument,
  "alert-dialog": AlertDialogDocument,
  avatar: AvatarDocument,
  badge: BadgeDocument,
  button: ButtonDocument,
  "button-group": ButtonGroupDocument,
  card: CardDocument,
  chat: ChatDocument,
  checkbox: CheckboxDocument,
  "code-block": CodeBlockDocument,
  command: CommandDocument,
  "context-menu": ContextMenuDocument,
  dialog: DialogDocument,
  "data-table": DataTableDocument,
  drawer: DrawerDocument,
  "dropdown-menu": DropdownMenuDocument,
  empty: EmptyDocument,
  "form-field": FormFieldDocument,
  "file-upload": FileUploadDocument,
  "hover-card": HoverCardDocument,
  "image-preview": ImagePreviewDocument,
  input: InputDocument,
  "input-group": InputGroupDocument,
  item: ItemDocument,
  kbd: KbdDocument,
  menu: MenuDocument,
  popover: PopoverDocument,
  pagination: PaginationDocument,
  progress: ProgressDocument,
  "radio-group": RadioGroupDocument,
  resizable: ResizableDocument,
  "scroll-area": ScrollAreaDocument,
  select: SelectDocument,
  separator: SeparatorDocument,
  settings: SettingsDocument,
  sheet: SheetDocument,
  "sidebar-layout": SidebarLayoutDocument,
  skeleton: SkeletonDocument,
  slider: SliderDocument,
  spinner: SpinnerDocument,
  switch: SwitchDocument,
  tabs: TabsDocument,
  table: TableDocument,
  textarea: TextareaDocument,
  toaster: ToasterDocument,
  toggle: ToggleDocument,
  tooltip: TooltipDocument,
  typography: TypographyDocument,
  workboard: WorkboardDocument,
};
