/**
 * Downcity UI 组件展示页。
 *
 * 页面只组合 `@downcity/ui` 的公开能力，用静态示例数据展示组件外观与交互，
 * 不连接 Agent、City 或其他业务运行时。
 */

import { useState } from "react";
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
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Toaster,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Workboard,
  type DowncityButtonVariant,
  type DowncityWorkboardBoardSnapshot,
} from "@downcity/ui";
import type { SectionHeadingProps } from "./types/components.js";

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
    totalAgents: 3,
    liveAgents: 2,
    activeAgents: 2,
    quietAgents: 1,
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
      currentCount: 2,
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
            summary: "组合基础组件、浮层和状态反馈。",
            status: "active",
            updatedAt: "2026-07-30T08:29:00.000Z",
            tags: ["react", "vite"],
          },
          {
            id: "ui-style",
            kind: "focus",
            title: "Visual language",
            summary: "验证 UI SDK 的设计令牌和响应式表现。",
            status: "steady",
            updatedAt: "2026-07-30T08:27:00.000Z",
            tags: ["tailwind", "tokens"],
          },
        ],
        recent: [
          {
            id: "ui-bootstrap",
            kind: "progress",
            title: "Vite bootstrap",
            summary: "完成独立 React 宿主应用初始化。",
            status: "steady",
            updatedAt: "2026-07-30T08:20:00.000Z",
            tags: ["template"],
          },
        ],
        signals: [
          { label: "Build", value: "ready", tone: "accent" },
          { label: "Coverage", value: "18 primitives", tone: "neutral" },
        ],
      },
    },
    {
      id: "runtime-agent",
      name: "Runtime Agent",
      running: true,
      headline: "检查宿主集成边界",
      posture: "reviewing",
      momentum: "steady",
      statusText: "审阅中",
      collectedAt: "2026-07-30T08:28:00.000Z",
      currentCount: 1,
      recentCount: 1,
      signalCount: 2,
      snapshot: {
        name: "Runtime Agent",
        running: true,
        statusText: "审阅中",
        collectedAt: "2026-07-30T08:28:00.000Z",
        headline: "检查宿主集成边界",
        posture: "reviewing",
        momentum: "steady",
        visibilityNote: "只展示公开宿主集成状态",
        current: [
          {
            id: "runtime-boundary",
            kind: "focus",
            title: "Host boundary",
            summary: "确认展示层不依赖 Agent 运行时。",
            status: "active",
            updatedAt: "2026-07-30T08:28:00.000Z",
            tags: ["architecture"],
          },
        ],
        recent: [
          {
            id: "runtime-types",
            kind: "progress",
            title: "Public types",
            summary: "验证 Workboard 只接收公开快照。",
            status: "steady",
            updatedAt: "2026-07-30T08:18:00.000Z",
            tags: ["types"],
          },
        ],
        signals: [
          { label: "Boundary", value: "clean", tone: "accent" },
          { label: "Runtime", value: "detached", tone: "neutral" },
        ],
      },
    },
    {
      id: "docs-agent",
      name: "Docs Agent",
      running: false,
      headline: "等待下一轮文档同步",
      posture: "idle",
      momentum: "paused",
      statusText: "空闲",
      collectedAt: "2026-07-30T08:10:00.000Z",
      currentCount: 0,
      recentCount: 1,
      signalCount: 1,
      snapshot: {
        name: "Docs Agent",
        running: false,
        statusText: "空闲",
        collectedAt: "2026-07-30T08:10:00.000Z",
        headline: "等待下一轮文档同步",
        posture: "idle",
        momentum: "paused",
        visibilityNote: "当前没有进行中的文档任务",
        current: [],
        recent: [
          {
            id: "docs-installation",
            kind: "idle",
            title: "Installation guide",
            summary: "已核对 UI SDK 样式导入顺序。",
            status: "waiting",
            updatedAt: "2026-07-30T08:10:00.000Z",
            tags: ["docs"],
          },
        ],
        signals: [{ label: "Queue", value: "empty", tone: "neutral" }],
      },
    },
  ],
};

/** 组件组通用标题，保持各展示区域的层级一致。 */
function SectionHeading(props: SectionHeadingProps) {
  return (
    <div className="mb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        @downcity/ui
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{props.title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        {props.description}
      </p>
    </div>
  );
}

/** UI SDK 独立展示应用。 */
export function App() {
  const [selected_agent_id, set_selected_agent_id] = useState("ui-builder");

  return (
    <TooltipProvider>
      <div className="min-h-screen text-foreground">
        <header className="border-b border-border/70 bg-background/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-12 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:py-16">
            <div>
              <Badge variant="outline">React + Vite</Badge>
              <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-[-0.055em] sm:text-6xl">
                Downcity UI Showcase
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
                一个只负责展示 packages/ui 公开组件的独立前端。这里的每个示例都通过
                <code className="mx-1 rounded bg-secondary px-1.5 py-0.5 text-sm text-foreground">
                  @downcity/ui
                </code>
                导入。
              </p>
            </div>
            <nav className="flex flex-wrap gap-2" aria-label="展示区域">
              <Button render={<a href="#primitives" />} variant="outline" size="sm">
                基础组件
              </Button>
              <Button render={<a href="#overlays" />} variant="outline" size="sm">
                浮层交互
              </Button>
              <Button render={<a href="#workboard" />} variant="outline" size="sm">
                Workboard
              </Button>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-7xl space-y-20 px-5 py-14 sm:px-8 sm:py-20">
          <section id="primitives" className="scroll-mt-6">
            <SectionHeading
              title="基础组件"
              description="按钮、状态、内容容器和表单原语可以直接组合成宿主应用界面。"
            />
            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Actions & status</CardTitle>
                  <CardDescription>Button、Badge、Toggle 与 ToggleGroup。</CardDescription>
                  <CardAction>
                    <Badge>Ready</Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex flex-wrap gap-2">
                    {button_variants.map((button_variant) => (
                      <Button key={button_variant} variant={button_variant}>
                        {button_variant}
                      </Button>
                    ))}
                  </div>
                  <Separator />
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>active</Badge>
                    <Badge variant="secondary">queued</Badge>
                    <Badge variant="outline">draft</Badge>
                    <Badge variant="destructive">issue</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Toggle variant="outline" defaultPressed>
                      Inspect
                    </Toggle>
                    <ToggleGroup variant="outline" defaultValue={["grid"]}>
                      <ToggleGroupItem value="list">List</ToggleGroupItem>
                      <ToggleGroupItem value="grid">Grid</ToggleGroupItem>
                      <ToggleGroupItem value="map">Map</ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </CardContent>
                <CardFooter className="text-xs text-muted-foreground">
                  所有交互均保留键盘焦点状态。
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Form controls</CardTitle>
                  <CardDescription>Input、Textarea、Checkbox 与 Label。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="project_name">Project name</Label>
                    <Input id="project_name" defaultValue="downcity-ui" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="project_brief">Brief</Label>
                    <Textarea
                      id="project_brief"
                      defaultValue="Compose an interface from reusable Downcity UI primitives."
                      rows={4}
                    />
                  </div>
                  <Label className="w-fit cursor-pointer">
                    <Checkbox defaultChecked />
                    Enable live preview
                  </Label>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Tabs</CardTitle>
                  <CardDescription>在同一层级切换信息面板。</CardDescription>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="overview">
                    <TabsList>
                      <TabsTrigger value="overview">Overview</TabsTrigger>
                      <TabsTrigger value="activity">Activity</TabsTrigger>
                      <TabsTrigger value="settings">Settings</TabsTrigger>
                    </TabsList>
                    <TabsContent value="overview" className="pt-5 leading-6 text-muted-foreground">
                      UI 包只负责界面组件、样式和类型，宿主负责状态与业务行为。
                    </TabsContent>
                    <TabsContent value="activity" className="pt-5 leading-6 text-muted-foreground">
                      展示应用通过公开 API 验证组件组合和 Tailwind 扫描配置。
                    </TabsContent>
                    <TabsContent value="settings" className="pt-5 leading-6 text-muted-foreground">
                      可在宿主样式层继续扩展布局，但无需改动组件内部实现。
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Loading state</CardTitle>
                  <CardDescription>Skeleton 用于保持异步内容加载时的结构稳定。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <Skeleton className="size-12 rounded-2xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-2/5" />
                      <Skeleton className="h-3 w-4/5" />
                    </div>
                  </div>
                  <Skeleton className="h-28 w-full rounded-2xl" />
                </CardContent>
              </Card>
            </div>
          </section>

          <section id="overlays" className="scroll-mt-6">
            <SectionHeading
              title="浮层与上下文交互"
              description="Popover、DropdownMenu、Dialog、Sheet 和 Tooltip 覆盖不同的信息密度与阻断程度。"
            />
            <Card>
              <CardContent className="flex flex-wrap items-center gap-3 pt-5">
                <Popover>
                  <PopoverTrigger render={<Button variant="outline" />}>Popover</PopoverTrigger>
                  <PopoverContent className="w-72 p-4">
                    <p className="font-medium">轻量上下文</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      适合补充说明、筛选或少量设置。
                    </p>
                  </PopoverContent>
                </Popover>

                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" />}>
                    Dropdown menu
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuLabel>Project</DropdownMenuLabel>
                    <DropdownMenuGroup>
                      <DropdownMenuItem>
                        Open preview
                        <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
                      </DropdownMenuItem>
                      <DropdownMenuItem>Duplicate</DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Dialog>
                  <DialogTrigger render={<Button variant="outline" />}>Dialog</DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Publish showcase?</DialogTitle>
                      <DialogDescription>
                        Dialog 适合需要明确确认的阻断式操作。
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <DialogClose render={<Button variant="ghost" />}>取消</DialogClose>
                      <DialogClose render={<Button />}>确认发布</DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Sheet>
                  <SheetTrigger render={<Button variant="outline" />}>Sheet</SheetTrigger>
                  <SheetContent side="right">
                    <SheetHeader>
                      <SheetTitle>Showcase settings</SheetTitle>
                      <SheetDescription>Sheet 适合较长的配置与辅助工作流。</SheetDescription>
                    </SheetHeader>
                    <div className="space-y-5 px-4">
                      <div className="space-y-2">
                        <Label htmlFor="theme_name">Theme name</Label>
                        <Input id="theme_name" defaultValue="Downcity Light" />
                      </div>
                      <Label className="w-fit cursor-pointer">
                        <Checkbox defaultChecked />
                        Show component labels
                      </Label>
                    </div>
                    <SheetFooter>
                      <SheetClose render={<Button />}>保存设置</SheetClose>
                    </SheetFooter>
                  </SheetContent>
                </Sheet>

                <Tooltip>
                  <TooltipTrigger render={<Button variant="outline" />}>Hover me</TooltipTrigger>
                  <TooltipContent>Tooltip 用于简短提示</TooltipContent>
                </Tooltip>
              </CardContent>
            </Card>
          </section>

          <section id="workboard" className="scroll-mt-6">
            <SectionHeading
              title="Workboard"
              description="复合组件只消费宿主提供的公开快照，并通过回调把选择意图交还给宿主。"
            />
            <Workboard
              board={demo_board}
              selectedAgentId={selected_agent_id}
              onSelectAgent={set_selected_agent_id}
              onRefresh={() => undefined}
            />
          </section>
        </main>

        <footer className="border-t border-border/70 bg-background">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-8 text-sm text-muted-foreground sm:px-8 sm:flex-row sm:items-center sm:justify-between">
            <span>templates/ui</span>
            <span>Powered by React, Vite, Tailwind CSS and @downcity/ui</span>
          </div>
        </footer>
        <Toaster theme="light" />
      </div>
    </TooltipProvider>
  );
}
