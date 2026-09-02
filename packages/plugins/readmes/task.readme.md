# Task

Creates and manages reusable Agent tasks, trigger definitions, and execution records.

Tasks remain Agent-owned runtime resources. Each Task binds one execution Workspace and can optionally bind a Session that receives its completed result.

The Desktop workspace groups Tasks by Agent. You can create, edit, pause, enable, run, and delete Tasks there. Selecting a Task opens its execution-history Subbar beside the primary Sidebar, while the Mainview shows output, status, duration, validation results, and failure details without reading private runtime files directly.

Successful and failed runs publish unread notifications after their run artifacts are persisted. Skipped runs do not notify. Desktop shows the unread state on the Task navigation entry, Task item, matching Run, and system app badge; opening that Run marks it read.
