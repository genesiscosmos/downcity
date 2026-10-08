/**
 * FormField 示例。
 */
import { FormField, Input, Textarea } from "@downcity/ui";

export default function FormFieldPreview() {
  return (
    <div className="grid w-full max-w-sm gap-5">
      <FormField label="Agent id" description="Stable identifier used by sessions." required>
        <Input placeholder="repo-helper" />
      </FormField>
      <FormField label="Access token" error="Token is required for remote agents.">
        <Input placeholder="sk-…" />
      </FormField>
      <FormField label="Instruction" horizontal>
        <Textarea placeholder="You are a reliable project assistant." />
      </FormField>
    </div>
  );
}
