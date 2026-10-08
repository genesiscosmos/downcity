/**
 * Popover 示例。
 *
 * Popover 承载需要停留阅读的内容；如果只是一句提示，用 Tooltip 更合适。
 */
import { Button, Popover, PopoverContent, PopoverTrigger } from "@downcity/ui";

export default function PopoverPreview() {
  return (
    <Popover>
      <PopoverTrigger render={(props) => <Button variant="outline" {...props}>Model settings</Button>} />
      <PopoverContent className="w-72">
        <p className="text-sm font-medium">Temperature</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Lower values make tool selection more deterministic.
        </p>
      </PopoverContent>
    </Popover>
  );
}
