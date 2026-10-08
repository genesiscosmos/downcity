/**
 * Item 示例。
 *
 * Item 用于列表中的单条记录：媒体、主文案、补充说明与右侧操作各自成槽位。
 */
import { Badge, Button, Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@downcity/ui";
import { IconRobot } from "@tabler/icons-react";

export default function ItemPreview() {
  return (
    <ItemGroup className="w-full max-w-md">
      <Item variant="outline">
        <ItemMedia variant="icon">
          <IconRobot className="size-4" />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>repo-helper</ItemTitle>
          <ItemDescription>Summarizes the repository and answers follow-ups.</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant="secondary">Active</Badge>
        </ItemActions>
      </Item>
      <Item variant="outline">
        <ItemMedia variant="icon">
          <IconRobot className="size-4" />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>release-notes</ItemTitle>
          <ItemDescription>Drafts the changelog from merged pull requests.</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button size="sm" variant="ghost">
            Open
          </Button>
        </ItemActions>
      </Item>
    </ItemGroup>
  );
}
