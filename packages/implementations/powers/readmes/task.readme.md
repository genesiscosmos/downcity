# Task

TaskPower owns personal todos, Agent/script work, scheduling, occurrences, and task handling in one City-level store. Inbox, Todo, and Calendar are entry points into the same Task aggregate, not separate task systems.

Desktop capture saves the user's text immediately without requiring a model or preview confirmation. TaskPower prepares the task asynchronously through a host-injected analysis port. Preparation state, input revisions, supplements, and authorization evidence persist in the same task aggregate. Missing information and preparation failures remain actionable in task details and Inbox. Manual edits invalidate stale analysis responses.

Explicit reminder, scheduled execution, or immediate Agent execution requests can enable a persisted trigger after target, time, and authorization checks. Selecting an executor alone does not authorize immediate execution. These checks currently recognize a limited set of explicit Chinese and English expressions; ambiguous requests require clarification or manual configuration. Planned time and trigger time are separate. Schedule synchronization errors remain visible and can be retried without another model call.

Every Task has a stable ID independent of its editable title. Duplicate titles are allowed. Agent actions return task IDs; existing selectors named `title` accept an ID or a unique title. Personal work uses `kind=self` and requires no Agent or Workspace. Agent/script execution targets remain rebindable, while the captured result-delivery Session stays fixed.

Work status, scheduler status, Run status, and Inbox resolution are independent. One-time Agent work awaits explicit acceptance after a successful valid run. Recurring Agent work completes each successful occurrence unless per-occurrence acceptance is enabled. Personal reminders create occurrences without manufacturing Agent Runs. Retries retain occurrence identity and preserve separate Run records.

Definitions, workflow metadata, occurrences, and Inbox history commit atomically in `task.md` through the shared definition repository. Run artifacts stay in their existing directories. Execution input uses the accepted definition snapshot; execution tokens prevent stale results from changing current work. Concurrent executions of one Task are rejected, and overlapping recurring triggers are recorded as skipped.

TaskPower has no Sidebar, Mainview, or Config renderer. The Desktop app owns native Inbox, Todo, Calendar, and shared task/run details, connected through a dedicated task IPC controller. Inbox currently handles organization, reminders, failures, missed one-time triggers, and acceptance. Reading a notification does not resolve an Inbox request. Approvals and questions remain in their original Session until reliable request-response routing is available. Running Tasks cannot currently be edited, cancelled, or deleted from the workspace.

Calendar provides week/month views, separate planned/due markers, one-time drag rescheduling, and fixed-time daily/weekly/monthly predictions in the task timezone. Advanced Cron remains available but is not expanded into calendar predictions. Future recurring occurrences can be skipped; per-occurrence rescheduling is deferred.

Automatic scheduling requires a running City. One-time triggers missed by more than a minute become explicit Inbox requests and are paused instead of replayed. Offline recurring triggers are not replayed in a burst; a persisted downtime-gap summary is not yet implemented. Successful and failed persisted Runs publish unread notifications with stable Task/Run routes; skipped runs do not notify.

Before scheduling starts, TaskPower reconciles persisted active execution markers with completed Run metadata. Valid completed results restore acceptance or failure handling; executions without a valid completed record become interruption items and their schedules are paused. Interrupted work is not automatically replayed. Progress snapshots alone cannot prove successful completion. Scheduler requests include their expected trigger rule, which is checked again inside the execution acceptance transaction to reject stale callbacks after rescheduling or pausing.

Definition corruption is surfaced as an unscheduled error item. Scheduler reconciliation failure is reported separately from a committed definition, and lifecycle disposal attempts every resource settlement before aggregating failures.
