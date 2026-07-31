/**
 * 基础原语的独立展示示例。
 *
 * 与主预览分离，保证单个模块保持可维护的规模；示例仅调用 `@downcity/ui` 的公开 API。
 */

import { useState, type ReactNode } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaViewport,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@downcity/ui";

import type { ShowcaseComponentId } from "../types/components.js";

/** 基础组件示例统一使用的画布容器。 */
function PreviewCanvas({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <div className={compact ? "flex min-h-64 items-center justify-center rounded-xl border border-divider bg-surface-emphasis p-6" : "flex min-h-[420px] items-center justify-center rounded-xl border border-divider bg-surface-emphasis p-6 sm:p-10"}>
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  );
}

/** 渲染新增加的基础原语示例。 */
export function FoundationPreview({ component_id }: { component_id: ShowcaseComponentId }) {
  const [selected_value, set_selected_value] = useState("balanced");

  switch (component_id) {
    case "accordion":
      return <PreviewCanvas compact><Accordion className="mx-auto max-w-lg" defaultValue={["runtime"]}><AccordionItem value="runtime"><AccordionTrigger>Runtime ownership</AccordionTrigger><AccordionContent className="px-2 pb-3">The host application owns state, data, and side effects.</AccordionContent></AccordionItem><AccordionItem value="styling"><AccordionTrigger>Shared styling</AccordionTrigger><AccordionContent className="px-2 pb-3">The UI package supplies tokens and composable primitives.</AccordionContent></AccordionItem></Accordion></PreviewCanvas>;
    case "alert":
      return <PreviewCanvas compact><div className="mx-auto flex max-w-lg flex-col gap-3"><Alert><div><AlertTitle>Changes saved</AlertTitle><AlertDescription>Your local component preview is up to date.</AlertDescription></div></Alert><Alert variant="destructive"><div><AlertTitle>Publish blocked</AlertTitle><AlertDescription>Resolve the required fields before continuing.</AlertDescription></div></Alert></div></PreviewCanvas>;
    case "alert-dialog":
      return <PreviewCanvas compact><div className="flex justify-center"><AlertDialog><AlertDialogTrigger render={<Button variant="destructive" />}>Delete draft</AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this draft?</AlertDialogTitle><AlertDialogDescription>This cannot be undone after confirmation.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose><AlertDialogClose render={<Button variant="destructive" />}>Delete</AlertDialogClose></AlertDialogFooter></AlertDialogContent></AlertDialog></div></PreviewCanvas>;
    case "avatar":
      return <PreviewCanvas compact><div className="flex justify-center gap-3"><Avatar><AvatarImage src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=96&q=80" alt="Avery Stone" /><AvatarFallback>AS</AvatarFallback></Avatar><Avatar className="size-10"><AvatarFallback>DC</AvatarFallback></Avatar><Avatar className="size-12"><AvatarFallback>UI</AvatarFallback></Avatar></div></PreviewCanvas>;
    case "breadcrumb":
      return <PreviewCanvas compact><Breadcrumb className="mx-auto w-fit"><BreadcrumbList><BreadcrumbItem><BreadcrumbLink href="#components">Components</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink href="#forms">Forms</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>Input group</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb></PreviewCanvas>;
    case "drawer":
      return <PreviewCanvas compact><div className="flex justify-center"><Drawer><DrawerTrigger render={<Button variant="outline" />}>Open drawer</DrawerTrigger><DrawerContent><DrawerHeader><DrawerTitle>Quick settings</DrawerTitle><DrawerDescription>Drawers keep lightweight mobile actions close to the viewport.</DrawerDescription></DrawerHeader><DrawerFooter><DrawerClose render={<Button />}>Done</DrawerClose></DrawerFooter></DrawerContent></Drawer></div></PreviewCanvas>;
    case "input-group":
      return <PreviewCanvas compact><InputGroup className="mx-auto max-w-md"><InputGroupAddon>https://</InputGroupAddon><InputGroupInput defaultValue="downcity.dev/components" aria-label="Component URL" /><InputGroupAddon align="inline-end">⌘K</InputGroupAddon></InputGroup></PreviewCanvas>;
    case "pagination":
      return <PreviewCanvas compact><Pagination><PaginationContent><PaginationItem><PaginationPrevious href="#previous" /></PaginationItem><PaginationItem><PaginationLink href="#one">1</PaginationLink></PaginationItem><PaginationItem><PaginationLink href="#two" isActive>2</PaginationLink></PaginationItem><PaginationItem><PaginationLink href="#three">3</PaginationLink></PaginationItem><PaginationItem><PaginationEllipsis /></PaginationItem><PaginationItem><PaginationNext href="#next" /></PaginationItem></PaginationContent></Pagination></PreviewCanvas>;
    case "progress":
      return <PreviewCanvas compact><Progress value={68} className="mx-auto flex max-w-md flex-col gap-2"><div className="flex items-center justify-between"><ProgressLabel>Component coverage</ProgressLabel><ProgressValue /></div><ProgressTrack><ProgressIndicator /></ProgressTrack></Progress></PreviewCanvas>;
    case "radio-group":
      return <PreviewCanvas compact><RadioGroup value={selected_value} onValueChange={set_selected_value} className="mx-auto flex max-w-md flex-col gap-3"><label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="concise" />Concise</label><label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="balanced" />Balanced</label><label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="detailed" />Detailed</label></RadioGroup></PreviewCanvas>;
    case "scroll-area":
      return <PreviewCanvas compact><ScrollArea className="mx-auto h-44 max-w-md overflow-hidden rounded-lg border border-divider"><ScrollAreaViewport><ScrollAreaContent className="p-3"><div className="flex flex-col gap-2">{["A compact surface", "Independent scrolling", "Native keyboard access", "Shared semantic tokens", "Composable content"].map((item, index) => <div key={item} className="rounded-md bg-surface-subtle px-3 py-2 text-sm"><span className="mr-2 text-muted-foreground">{index + 1}.</span>{item}</div>)}</div></ScrollAreaContent></ScrollAreaViewport><ScrollAreaScrollbar orientation="vertical" /></ScrollArea></PreviewCanvas>;
    case "table":
      return <PreviewCanvas compact><Table className="mx-auto max-w-xl"><TableHeader><TableRow><TableHead>Component</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Size</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>Button</TableCell><TableCell>Ready</TableCell><TableCell className="text-right">8 KB</TableCell></TableRow><TableRow><TableCell>Input group</TableCell><TableCell>Ready</TableCell><TableCell className="text-right">3 KB</TableCell></TableRow></TableBody></Table></PreviewCanvas>;
    default:
      return null;
  }
}
