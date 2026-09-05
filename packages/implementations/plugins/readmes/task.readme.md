# Task

Creates and manages reusable Agent tasks, trigger definitions, and execution records.

TaskPlugin owns one City-level Task store and scheduler. Each Task explicitly binds one execution Agent and Workspace, and can optionally bind a Session that receives its completed result.

The Desktop workspace uses a Task → runs tree. Clicking a Task opens its definition, while expanding it loads execution records. Tasks are not grouped by Agent or Workspace; those resources are only rebindable execution targets. You can create, edit, pause, enable, run, and delete Tasks there, including Tasks whose targets are no longer available, while the Mainview shows output, status, duration, validation results, and failure details without reading private runtime files directly.

Successful and failed runs publish unread notifications after their run artifacts are persisted. Skipped runs do not notify. Desktop shows the unread state on the Task navigation entry, Task item, matching Run, and system app badge; opening that Run marks it read.
