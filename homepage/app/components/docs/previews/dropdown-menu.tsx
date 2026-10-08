/**
 * DropdownMenu 示例。
 */
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@downcity/ui";

export default function DropdownMenuPreview() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={(props) => <Button variant="outline" {...props}>Actions</Button>} />
      <DropdownMenuContent align="start" className="min-w-[12rem]">
        <DropdownMenuLabel>Session</DropdownMenuLabel>
        <DropdownMenuItem>
          Rename
          <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Fork
          <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
