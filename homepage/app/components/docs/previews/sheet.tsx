/**
 * Sheet 示例。
 *
 * Sheet 用于从边缘滑入的次要流程；主流程仍应留在页面内，避免打断上下文。
 */
import {
  Button,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@downcity/ui";

export default function SheetPreview() {
  return (
    <Sheet>
      <SheetTrigger render={(props) => <Button variant="outline" {...props}>Session details</Button>} />
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Session details</SheetTitle>
          <SheetDescription>Model, workspace, and approval boundary.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-2 py-4 text-sm text-muted-foreground">
          <p>Model: deepseek-chat</p>
          <p>Workspace: project</p>
          <p>Approvals: required for shell</p>
        </div>
        <SheetFooter>
          <SheetClose render={(props) => <Button variant="ghost" {...props}>Close</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
