/**
 * Command 示例。
 */
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@downcity/ui";

export default function CommandPreview() {
  return (
    <Command className="w-full max-w-md rounded-xl border border-line">
      <CommandInput placeholder="Search sessions…" />
      <CommandList>
        <CommandEmpty>No sessions found.</CommandEmpty>
        <CommandGroup heading="Recent">
          <CommandItem value="repo-helper">
            repo-helper
            <CommandShortcut>⌘1</CommandShortcut>
          </CommandItem>
          <CommandItem value="release-notes">
            release-notes
            <CommandShortcut>⌘2</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="new-session">New session</CommandItem>
          <CommandItem value="fork-session">Fork current session</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
