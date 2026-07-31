/**
 * UI 展示页右侧单组件预览。
 *
 * 组件只组合 `@downcity/ui` 的公开 API；示例状态均为本地状态，
 * 不依赖 Agent、City 或其他业务运行时。
 */

import { useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  CodeBlock,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  FormField,
  H2,
  H3,
  ImagePreview,
  InfoRow,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Kbd,
  KbdGroup,
  Label,
  MenuEmpty,
  MenuGroup,
  MenuLabel,
  MenuSeparator,
  MenuSurface,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Separator,
  SettingGroup,
  SettingItem,
  SidebarLayout,
  SettingSection,
  SettingsContainer,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  Slider,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Workboard,
  type DowncityButtonVariant,
  type DowncityWorkboardBoardSnapshot,
} from "@downcity/ui";

import type { ComponentDemoProps, ShowcaseComponentId } from "../types/components.js";
import { FoundationPreview } from "./foundation-preview.js";
import { AdvancedPreview } from "./advanced-preview.js";

const button_variants = [
  "default",
  "outline",
  "secondary",
  "ghost",
  "destructive",
  "link",
] as const satisfies readonly DowncityButtonVariant[];

const demo_board: DowncityWorkboardBoardSnapshot = {
  summary: {
    totalAgents: 1,
    liveAgents: 1,
    activeAgents: 1,
    quietAgents: 0,
  },
  collectedAt: "2026-07-30T08:30:00.000Z",
  agents: [
    {
      id: "ui-builder",
      name: "UI Builder",
      running: true,
      headline: "正在整理组件展示页",
      posture: "focused",
      momentum: "shipping",
      statusText: "构建中",
      collectedAt: "2026-07-30T08:30:00.000Z",
      currentCount: 1,
      recentCount: 1,
      signalCount: 2,
      snapshot: {
        name: "UI Builder",
        running: true,
        statusText: "构建中",
        collectedAt: "2026-07-30T08:30:00.000Z",
        headline: "正在整理组件展示页",
        posture: "focused",
        momentum: "shipping",
        visibilityNote: "公开展示组件组合进度",
        current: [
          {
            id: "ui-layout",
            kind: "progress",
            title: "Showcase layout",
            summary: "组合 Sidebar 与单组件预览。",
            status: "active",
            updatedAt: "2026-07-30T08:29:00.000Z",
            tags: ["react", "vite"],
          },
        ],
        recent: [
          {
            id: "ui-primitives",
            kind: "focus",
            title: "Reusable primitives",
            summary: "完成通用组件和文档同步。",
            status: "steady",
            updatedAt: "2026-07-30T08:20:00.000Z",
            tags: ["ui", "docs"],
          },
        ],
        signals: [
          { label: "Build", value: "ready", tone: "accent" },
          { label: "Boundary", value: "clean", tone: "neutral" },
        ],
      },
    },
  ],
};

/** 为所有组件示例提供一致的演示画布。 */
function PreviewCanvas({
  children,
  compact = false,
}: {
  /** 画布中展示的组件示例。 */
  children: ReactNode;
  /** 是否使用更紧凑的最小高度。 */
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "flex min-h-64 items-center justify-center rounded-xl border border-divider bg-surface-emphasis p-6"
          : "flex min-h-[420px] items-center justify-center rounded-xl border border-divider bg-surface-emphasis p-6 sm:p-10"
      }
    >
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  );
}

/** ImagePreview 的本地受控示例。 */
function ImagePreviewDemo() {
  const [is_open, set_is_open] = useState(false);
  const image_src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='720' height='480' viewBox='0 0 720 480'%3E%3Crect width='720' height='480' fill='%23262626'/%3E%3Cpath d='M0 350 180 170l130 130 110-105 300 245v40H0Z' fill='%23606060'/%3E%3Ccircle cx='555' cy='120' r='45' fill='%23dedede'/%3E%3C/svg%3E";
  return <div className="flex flex-col items-center gap-3"><img className="h-24 w-36 rounded-lg object-cover" src={image_src} alt="Mountain landscape" /><Button onClick={() => set_is_open(true)}>Open image</Button><ImagePreview open={is_open} onOpenChange={set_is_open} src={image_src} alt="Mountain landscape" /></div>;
}

/** 根据当前标识渲染对应组件的交互示例。 */
function render_component_example(
  component_id: ShowcaseComponentId,
  editor_width: number,
  set_editor_width: (value: number) => void,
  selected_agent_id: string,
  set_selected_agent_id: (value: string) => void,
) {
  switch (component_id) {
    case "combobox":
    case "file-upload":
    case "data-table":
    case "resizable":
    case "hover-card":
      return <AdvancedPreview component_id={component_id} />;
    case "accordion":
    case "alert":
    case "alert-dialog":
    case "avatar":
    case "breadcrumb":
    case "drawer":
    case "input-group":
    case "pagination":
    case "progress":
    case "radio-group":
    case "scroll-area":
    case "table":
      return <FoundationPreview component_id={component_id} />;
    case "button":
      return (
        <PreviewCanvas compact>
          <div className="flex flex-wrap justify-center gap-3">
            {button_variants.map((variant) => (
              <Button key={variant} variant={variant}>{variant}</Button>
            ))}
          </div>
        </PreviewCanvas>
      );
    case "badge":
      return (
        <PreviewCanvas compact>
          <div className="flex flex-wrap justify-center gap-3">
            <Badge>active</Badge>
            <Badge variant="secondary">queued</Badge>
            <Badge variant="outline">draft</Badge>
            <Badge variant="destructive">issue</Badge>
          </div>
        </PreviewCanvas>
      );
    case "toggle":
      return (
        <PreviewCanvas compact>
          <div className="flex flex-col items-center gap-4">
            <Toggle variant="outline" defaultPressed>Inspect</Toggle>
            <ToggleGroup variant="outline" defaultValue={["grid"]}>
              <ToggleGroupItem value="list">List</ToggleGroupItem>
              <ToggleGroupItem value="grid">Grid</ToggleGroupItem>
              <ToggleGroupItem value="map">Map</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </PreviewCanvas>
      );
    case "spinner":
      return (
        <PreviewCanvas compact>
          <div className="flex items-center justify-center gap-6 text-muted-foreground">
            <Spinner size="sm" /><Spinner /><Spinner size="lg" />
            <Button disabled><Spinner /> Saving</Button>
          </div>
        </PreviewCanvas>
      );
    case "kbd":
      return (
        <PreviewCanvas compact>
          <div className="flex justify-center">
            <KbdGroup><Kbd>⌘</Kbd><Kbd>Shift</Kbd><Kbd>P</Kbd></KbdGroup>
          </div>
        </PreviewCanvas>
      );
    case "input":
      return (
        <PreviewCanvas compact>
          <div className="mx-auto flex max-w-sm flex-col gap-2">
            <Label htmlFor="project_name">Project name</Label>
            <Input id="project_name" defaultValue="downcity-ui" />
          </div>
        </PreviewCanvas>
      );
    case "form-field":
      return <PreviewCanvas compact><div className="mx-auto max-w-sm"><FormField label="Project name" description="Used in navigation and shared links." required><Input defaultValue="downcity-ui" /></FormField></div></PreviewCanvas>;
    case "textarea":
      return (
        <PreviewCanvas compact>
          <div className="mx-auto flex max-w-md flex-col gap-2">
            <Label htmlFor="project_brief">Brief</Label>
            <Textarea id="project_brief" rows={5} defaultValue="Compose an interface from reusable Downcity UI primitives." />
          </div>
        </PreviewCanvas>
      );
    case "checkbox":
      return (
        <PreviewCanvas compact>
          <Label className="mx-auto w-fit cursor-pointer"><Checkbox defaultChecked /> Enable live preview</Label>
        </PreviewCanvas>
      );
    case "code-block":
      return (
        <PreviewCanvas compact>
          <CodeBlock
            className="mx-auto max-w-xl"
            language="tsx"
            code={'import { Button } from "@downcity/ui";\n\nexport function Example() {\n  return <Button>Open project</Button>;\n}'}
          />
        </PreviewCanvas>
      );
    case "select":
      return (
        <PreviewCanvas compact>
          <Select defaultValue="balanced">
            <SelectTrigger className="mx-auto w-64"><SelectValue placeholder="Select style" /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Response style</SelectLabel>
                <SelectItem value="concise">Concise</SelectItem>
                <SelectItem value="balanced" description="Clear answers with useful context.">Balanced</SelectItem>
                <SelectItem value="detailed">Detailed</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </PreviewCanvas>
      );
    case "slider":
      return (
        <PreviewCanvas compact>
          <div className="mx-auto flex max-w-md flex-col gap-4">
            <div className="flex justify-between text-sm"><span>Editor width</span><span>{editor_width}%</span></div>
            <Slider value={editor_width} min={48} max={100} onValueChange={(value) => typeof value === "number" && set_editor_width(value)} />
          </div>
        </PreviewCanvas>
      );
    case "switch":
      return (
        <PreviewCanvas compact>
          <div className="flex items-center justify-center gap-3"><Switch defaultChecked aria-label="Enable preview" /><span className="text-sm">Live preview</span></div>
        </PreviewCanvas>
      );
    case "card":
      return (
        <PreviewCanvas>
          <Card className="mx-auto max-w-md">
            <CardHeader><CardTitle>Project status</CardTitle><CardDescription>Everything required for the release is ready.</CardDescription><CardAction><Badge>Ready</Badge></CardAction></CardHeader>
            <CardContent className="text-sm text-muted-foreground">Components, documentation, and host examples are synchronized.</CardContent>
            <CardFooter><Button size="sm">Open project</Button></CardFooter>
          </Card>
        </PreviewCanvas>
      );
    case "typography":
      return <PreviewCanvas compact><div className="mx-auto max-w-lg space-y-3"><H2>Project overview</H2><H3>Release status</H3><p className="text-sm text-muted-foreground">Typography primitives provide stable UI hierarchy without deciding page spacing.</p></div></PreviewCanvas>;
    case "tabs":
      return (
        <PreviewCanvas compact>
          <Tabs defaultValue="overview" className="mx-auto max-w-lg">
            <TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger><TabsTrigger value="settings">Settings</TabsTrigger></TabsList>
            <TabsContent value="overview" className="pt-5 text-sm leading-6 text-muted-foreground">UI primitives remain independent from the host runtime.</TabsContent>
            <TabsContent value="activity" className="pt-5 text-sm leading-6 text-muted-foreground">The latest component build completed successfully.</TabsContent>
            <TabsContent value="settings" className="pt-5 text-sm leading-6 text-muted-foreground">Host applications own state and behavior.</TabsContent>
          </Tabs>
        </PreviewCanvas>
      );
    case "item":
      return (
        <PreviewCanvas compact>
          <ItemGroup className="mx-auto max-w-lg">
            <Item variant="outline" render={<button type="button" />}>
              <ItemMedia variant="icon">UI</ItemMedia><ItemContent><ItemTitle>Component inventory</ItemTitle><ItemDescription>Inspect reusable primitives and composed patterns.</ItemDescription></ItemContent><ItemActions><Kbd>Enter</Kbd></ItemActions>
            </Item>
            <Item variant="muted" size="sm"><ItemMedia><Spinner size="sm" /></ItemMedia><ItemContent><ItemTitle>Refreshing metadata</ItemTitle></ItemContent></Item>
          </ItemGroup>
        </PreviewCanvas>
      );
    case "empty":
      return (
        <PreviewCanvas>
          <Empty className="mx-auto max-w-lg"><EmptyMedia>+</EmptyMedia><EmptyHeader><EmptyTitle>No saved views</EmptyTitle><EmptyDescription>Create a view to keep frequently used component filters close at hand.</EmptyDescription></EmptyHeader><EmptyContent><Button size="sm">Create view</Button></EmptyContent></Empty>
        </PreviewCanvas>
      );
    case "skeleton":
      return (
        <PreviewCanvas compact>
          <div className="mx-auto flex max-w-md flex-col gap-4"><div className="flex items-center gap-4"><Skeleton className="size-12 rounded-2xl" /><div className="flex flex-1 flex-col gap-2"><Skeleton className="h-4 w-2/5" /><Skeleton className="h-3 w-4/5" /></div></div><Skeleton className="h-28 w-full rounded-2xl" /></div>
        </PreviewCanvas>
      );
    case "separator":
      return (
        <PreviewCanvas compact>
          <div className="mx-auto max-w-md"><p className="text-sm font-medium">Overview</p><Separator className="my-4" /><p className="text-sm text-muted-foreground">Separator keeps adjacent regions visually distinct.</p></div>
        </PreviewCanvas>
      );
    case "settings":
      return (
        <PreviewCanvas>
          <SettingsContainer className="mx-auto max-w-xl"><SettingSection title="Editor" description="State remains owned by the host."><SettingGroup><SettingItem label="Live preview" description="Update the preview while editing."><Switch defaultChecked aria-label="Enable live preview" /></SettingItem><InfoRow label="UI package">@downcity/ui</InfoRow></SettingGroup></SettingSection></SettingsContainer>
        </PreviewCanvas>
      );
    case "sidebar-layout":
      return <PreviewCanvas compact><div className="mx-auto h-52 w-64 overflow-hidden rounded-lg border border-border"><SidebarLayout header={<div className="border-b border-divider px-3 py-2 text-xs font-medium">Workspace</div>} footer={<div className="border-t border-divider px-3 py-2 text-xs text-muted-foreground">Settings</div>}><div className="p-2 text-xs text-muted-foreground">Scrollable sidebar content</div></SidebarLayout></div></PreviewCanvas>;
    case "dropdown-menu":
      return (
        <PreviewCanvas compact>
          <div className="flex justify-center"><DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" />}>Open menu</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuGroup><DropdownMenuLabel>Project</DropdownMenuLabel><DropdownMenuItem>Open preview<DropdownMenuShortcut>⌘O</DropdownMenuShortcut></DropdownMenuItem><DropdownMenuItem>Duplicate</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem variant="destructive">Delete</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu></div>
        </PreviewCanvas>
      );
    case "context-menu":
      return (
        <PreviewCanvas compact>
          <ContextMenu><ContextMenuTrigger render={<div tabIndex={0} className="mx-auto flex min-h-36 max-w-sm cursor-context-menu items-center justify-center rounded-xl border border-dashed border-border-subtle text-sm text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30" />}>Right click this area</ContextMenuTrigger><ContextMenuContent><ContextMenuGroup><ContextMenuItem>Open component<ContextMenuShortcut>↵</ContextMenuShortcut></ContextMenuItem><ContextMenuItem>Copy import</ContextMenuItem></ContextMenuGroup><ContextMenuSeparator /><ContextMenuGroup><ContextMenuItem variant="destructive">Remove</ContextMenuItem></ContextMenuGroup></ContextMenuContent></ContextMenu>
        </PreviewCanvas>
      );
    case "popover":
      return (
        <PreviewCanvas compact>
          <div className="flex justify-center"><Popover><PopoverTrigger render={<Button variant="outline" />}>Open popover</PopoverTrigger><PopoverContent className="w-72 p-4"><p className="font-medium">Lightweight context</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Suitable for filters, explanations, and small settings.</p></PopoverContent></Popover></div>
        </PreviewCanvas>
      );
    case "dialog":
      return (
        <PreviewCanvas compact>
          <div className="flex justify-center"><Dialog><DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger><DialogContent><DialogHeader><DialogTitle>Publish showcase?</DialogTitle><DialogDescription>This action makes the latest component examples available.</DialogDescription></DialogHeader><DialogFooter><DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose><DialogClose render={<Button />}>Publish</DialogClose></DialogFooter></DialogContent></Dialog></div>
        </PreviewCanvas>
      );
    case "sheet":
      return (
        <PreviewCanvas compact>
          <div className="flex justify-center"><Sheet><SheetTrigger render={<Button variant="outline" />}>Open sheet</SheetTrigger><SheetContent side="right"><SheetHeader><SheetTitle>Showcase settings</SheetTitle><SheetDescription>Sheets support longer configuration workflows.</SheetDescription></SheetHeader><div className="px-4"><Label htmlFor="theme_name">Theme name</Label><Input id="theme_name" className="mt-2" defaultValue="Downcity Light" /></div><SheetFooter><SheetClose render={<Button />}>Save</SheetClose></SheetFooter></SheetContent></Sheet></div>
        </PreviewCanvas>
      );
    case "tooltip":
      return (
        <PreviewCanvas compact>
          <div className="flex justify-center"><Tooltip><TooltipTrigger render={<Button variant="outline" />}>Hover me</TooltipTrigger><TooltipContent>Short contextual hint</TooltipContent></Tooltip></div>
        </PreviewCanvas>
      );
    case "command":
      return (
        <PreviewCanvas>
          <Command className="mx-auto max-w-xl border border-border-subtle shadow-sm"><CommandInput placeholder="Search components..." /><CommandList><CommandEmpty>No components found.</CommandEmpty><CommandGroup heading="Components"><CommandItem value="command">Command<CommandShortcut>⌘K</CommandShortcut></CommandItem><CommandItem value="context-menu">Context menu</CommandItem><CommandItem value="empty">Empty state</CommandItem></CommandGroup></CommandList></Command>
        </PreviewCanvas>
      );
    case "toaster":
      return (
        <PreviewCanvas compact>
          <Card className="mx-auto max-w-md"><CardHeader><CardTitle>Application feedback</CardTitle><CardDescription>The Toaster is mounted once at the showcase root and inherits the shared theme tokens.</CardDescription></CardHeader><CardContent><Badge variant="outline">Mounted globally</Badge></CardContent></Card>
        </PreviewCanvas>
      );
    case "menu":
      return <PreviewCanvas compact><MenuSurface className="mx-auto w-56"><MenuGroup><MenuLabel>Project</MenuLabel><button type="button" className="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-interaction-hover">Open preview</button><button type="button" className="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-interaction-hover">Duplicate</button></MenuGroup><MenuSeparator /><MenuEmpty>More actions appear here.</MenuEmpty></MenuSurface></PreviewCanvas>;
    case "image-preview":
      return <PreviewCanvas compact><ImagePreviewDemo /></PreviewCanvas>;
    case "workboard":
      return (
        <div className="overflow-hidden rounded-2xl border border-border-subtle"><Workboard board={demo_board} selectedAgentId={selected_agent_id} onSelectAgent={set_selected_agent_id} onRefresh={() => undefined} /></div>
      );
  }
}

/** 供可信 MDX 文档嵌入的交互组件预览。 */
export function ComponentDemo({ component_id }: ComponentDemoProps) {
  const [editor_width, set_editor_width] = useState(72);
  const [selected_agent_id, set_selected_agent_id] = useState("ui-builder");

  return (
    <div className="not-prose">
      {render_component_example(
        component_id,
        editor_width,
        set_editor_width,
        selected_agent_id,
        set_selected_agent_id,
      )}
    </div>
  );
}
