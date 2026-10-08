/**
 * Tooltip 示例。
 *
 * Tooltip 只承载一句短提示，不放需要点击的内容或长段说明。
 */
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@downcity/ui";

export default function TooltipPreview() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={(props) => <Button variant="ghost" {...props}>Approve shell command</Button>} />
        <TooltipContent>Writes to the workspace require approval.</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
