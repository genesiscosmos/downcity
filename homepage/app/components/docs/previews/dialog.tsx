/**
 * Dialog 示例。
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@downcity/ui";

export default function DialogPreview() {
  return (
    <Dialog>
      <DialogTrigger render={(props) => <Button {...props}>Delete session</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this session?</DialogTitle>
          <DialogDescription>
            The transcript and its tool call history are removed permanently.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={(props) => <Button variant="ghost" {...props}>Cancel</Button>} />
          <Button variant="destructive">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
