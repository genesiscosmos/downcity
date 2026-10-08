/**
 * Empty 示例。
 */
import { Button, Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@downcity/ui";
import { InboxIcon } from "lucide-react";

export default function EmptyPreview() {
  return (
    <Empty className="w-full max-w-md">
      <EmptyHeader>
        <EmptyMedia>
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>No sessions yet</EmptyTitle>
        <EmptyDescription>Start a session to see its turns and tool calls here.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm">New session</Button>
      </EmptyContent>
    </Empty>
  );
}
