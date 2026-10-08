/**
 * Textarea 示例。
 */
import { Textarea } from "@downcity/ui";

export default function TextareaPreview() {
  return (
    <Textarea
      className="w-full max-w-sm"
      placeholder="Describe the task for this agent"
      defaultValue={"Summarize the repository structure\nand list the entry points."}
    />
  );
}
