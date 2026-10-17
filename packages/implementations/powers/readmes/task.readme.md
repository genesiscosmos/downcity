# Task

TaskPower owns personal todos, Agent/script work, scheduling, occurrences, and task handling in one City-level store. Inbox, Todo, and Calendar are entry points into the same Task aggregate, not separate task systems.

Desktop capture saves the user's original text, then generates a complete proposal inline through a host-injected analysis port. Proposal revisions, adjustments, generated instructions, and default assumptions persist in the same task aggregate. Available targets and source context fill unspecified fields instead of producing a missing-information questionnaire. A missing model or execution environment is reported as a specific configuration error. Manual edits invalidate stale analysis responses.

Capture and prepare leave the proposal paused. Users confirm the displayed revision or continue adjusting the same task. Only confirm activates the arrangement; stale revisions are rejected and repeating confirmation does not generate a second startup request. Agent proposals without a time default to immediate execution after confirmation unless explicitly manual. Scheduled work and personal reminders wait for their confirmed trigger. Planned time and trigger time are separate. Schedule synchronization errors remain visible and can be retried without another model call.

Every Task has a stable ID independent of its editable title. Duplicate titles are allowed. Agent actions return task IDs; existing selectors named `title` accept an ID or a unique title. Personal work uses `kind=self` and requires no Agent or Workspace. Agent/script execution targets remain rebindable, while the captured result-delivery Session stays fixed.

Work status, scheduler status, Run status, and Inbox resolution are independent. One-time Agent work awaits explicit acceptance after a successful valid run. Recurring Agent work completes each successful occurrence unless per-occurrence acceptance is enabled. Personal reminders create occurrences without manufacturing Agent Runs. Retries retain occurrence identity and preserve separate Run records.

Definitions, workflow metadata, occurrences, and Inbox history commit atomically in `task.md` through the shared definition repository. Run artifacts stay in their existing directories. Execution input uses the accepted definition snapshot; execution tokens prevent stale results from changing current work. Concurrent executions of one Task are rejected, and overlapping recurring triggers are recorded as skipped.

TaskPower has no Sidebar, Mainview, or Config renderer. The Desktop app owns native Inbox, Todo, Calendar, and shared task/run details, connected through a dedicated task IPC controller. Inbox currently handles organization, reminders, failures, missed one-time triggers, and acceptance. Reading a notification does not resolve an Inbox request. Approvals and questions remain in their original Session until reliable request-response routing is available. Running Tasks cannot currently be edited, cancelled, or deleted from the workspace.

Calendar provides week/month views, separate planned/due markers, one-time drag rescheduling, and fixed-time daily/weekly/monthly predictions in the task timezone. Advanced Cron remains available but is not expanded into calendar predictions. Future recurring occurrences can be skipped; per-occurrence rescheduling is deferred.

Automatic scheduling requires a running City. One-time triggers missed by more than a minute become explicit Inbox requests and are paused instead of replayed. Offline recurring triggers are not replayed in a burst; a persisted downtime-gap summary is not yet implemented. Successful and failed persisted Runs publish unread notifications with stable Task/Run routes; skipped runs do not notify.

Before scheduling starts, TaskPower reconciles persisted active execution markers with completed Run metadata. Valid completed results restore acceptance or failure handling; executions without a valid completed record become interruption items and their schedules are paused. Interrupted work is not automatically replayed. Progress snapshots alone cannot prove successful completion. Scheduler requests include their expected trigger rule, which is checked again inside the execution acceptance transaction to reject stale callbacks after rescheduling or pausing.

Definition corruption is surfaced as an unscheduled error item. Scheduler reconciliation failure is reported separately from a committed definition, and lifecycle disposal attempts every resource settlement before aggregating failures.
