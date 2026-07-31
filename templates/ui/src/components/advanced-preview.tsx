/** 第二批高复用组件的独立展示示例。 */
import { useState, type ReactNode } from "react";
import { Badge, Button, DataTable, FileUpload, HoverCard, HoverCardContent, HoverCardTrigger, ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@downcity/ui";
import type { ShowcaseComponentId } from "../types/components.js";
const preview_canvas = (children: ReactNode) => <div className="flex min-h-64 items-center justify-center rounded-xl border border-divider p-6"><div className="w-full max-w-2xl">{children}</div></div>;
const rows = [{ id: "button", status: "Ready", size: "8 KB" }, { id: "data-table", status: "Ready", size: "12 KB" }];
/** 渲染高复用组件的交互示例。 */
export function AdvancedPreview({ component_id }: { component_id: ShowcaseComponentId }) {
  const [files, set_files] = useState<File[]>([]);
  switch (component_id) {
    case "file-upload": return preview_canvas(<FileUpload className="mx-auto max-w-md" files={files} onFilesChange={set_files} accept="image/*,.pdf" label="Drop assets here" description="Images or PDF, up to your host policy." />);
    case "data-table": return preview_canvas(<DataTable className="mx-auto max-w-xl" data={rows} getRowId={(row) => row.id} columns={[{ id: "component", header: "Component", cell: (row) => row.id }, { id: "status", header: "Status", cell: (row) => <Badge variant="secondary">{row.status}</Badge> }, { id: "size", header: "Size", align: "right", cell: (row) => row.size }]} />);
    case "resizable": return preview_canvas(<div className="mx-auto h-44 max-w-xl overflow-hidden rounded-lg border border-divider"><ResizablePanelGroup orientation="horizontal"><ResizablePanel defaultSize="40%"><div className="h-full bg-surface-subtle p-3 text-sm">Navigator</div></ResizablePanel><ResizableHandle withHandle /><ResizablePanel><div className="h-full p-3 text-sm">Editable content</div></ResizablePanel></ResizablePanelGroup></div>);
    case "hover-card": return preview_canvas(<div className="flex justify-center"><HoverCard><HoverCardTrigger render={<Button variant="outline" />}>Hover profile</HoverCardTrigger><HoverCardContent><p className="font-medium">UI Builder</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Maintains reusable components, examples, and public API documentation.</p></HoverCardContent></HoverCard></div>);
    default: return null;
  }
}
