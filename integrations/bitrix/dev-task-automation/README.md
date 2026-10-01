# Development task automation in Bitrix24

This integration runs in the existing self-hosted Bitrix24 CRM, separately from the NestJS API. It uses native CRM operations, a local business-process activity and the existing minute-based Bitrix agent scheduler. It does not replace the CRM factory or change permissions.

**Current delivery mode is preview.** Every new integration notification is routed only to Artem (user 3), with a label naming its intended recipient. No new notification is sent to the actual developer, setter or other department head. Preview delivery state and tags are separate from live state. Enabling real delivery requires a later explicit human instruction and a configuration change; the deployment tool deliberately enables preview only.

## Rules

Development tasks are smart-process type 1072, currently category 18. The guard is the first action in the existing In-work automation template 217. It returns a conflicting newly entered task to its previous stage. Existing actions execute only after the guard permits the entry. Rollback preserves CRM stage history and interface updates, while disabling business processes and automation for that rollback operation so it does not trigger unrelated prior-stage actions again.

The custom redline is a date, evaluated in Europe/Moscow. Deadline reminders are sent at the first scheduled check at or after 10:00, Monday to Friday. A task is included on its redline date and every overdue weekday until completion or cancellation. Each recipient receives one combined daily deadline digest. If the server is unavailable at 10:00, it catches up later that day; it does not replay messages for missed days.

Digests larger than the Bitrix message limit are split between complete task rows into numbered parts. Pending delivery retries reuse those exact parts and stop if recipients, dates or alert conditions change.

Recipients are the responsible employee, all employees in the custom Setter field, and the current head of Development department 23. In the Check stage, daily deadline reminders concern waiting for analyst review and go to the setters and department head. The developer is excluded from this daily reminder even if also listed as a setter; the department head remains eligible when occupying several roles.

For a task currently in Check, the developer's delivery date comes from the latest current visit to that stage in native CRM history, converted to a Moscow calendar date. Delivery on or before the date-only redline produces no developer deadline reminder. Late delivery produces a separate request to write a comment explaining the delay, addressed to the developer and head once per visit/redline/recipient. Returning to development and handing off again starts a new visit. An unknown or inconsistent history entry never accuses a developer of late delivery. This request uses the same weekday/10:00 window, but has independent delivery state so an earlier daily reminder cannot suppress it.

All actual hours from linked daily reports count, including reports hidden from client/support output. New actual effort above the developer estimate is reported to the developer and department head; in Check, to the setters and head. Effort above client hours is reported to the setters and head. These alerts run on the minute-based schedule, including weekends, and repeat only after the hours drop back within the limit and cross it again, the limit changes, or a new eligible recipient needs the existing alert. Missing/zero limits do not produce overrun alerts.

Completed/cancelled custom stages are explicitly excluded because their Bitrix stage semantics are empty. Native successful/failed stages are also excluded. Deleted reports are excluded by native CRM reads. Existing overdue tasks are included in the first daily digest. Existing overrun tasks are included in the first overrun digest rather than generating one message per task.

## Files and deployment

- `src/` and `bootstrap.php` map to `/home/bitrix/www/local/php_interface/evolution/dev_tasks/`.
- `activities/evolutiondevtaskguard/` maps to `/home/bitrix/www/local/activities/evolutiondevtaskguard/`.
- Add `require_once $_SERVER['DOCUMENT_ROOT'] . '/local/php_interface/evolution/dev_tasks/bootstrap.php';` to the existing `bitrix/php_interface/init.php` without changing its other includes.
- `tools/configure.php` is CLI-only. Keep deployment tools, configuration snapshots and template exports outside the web root.

Before deployment, back up the existing init file, any existing integration/activity files and the workflow. Upload the integration and lint all PHP files. `configure.php check /home/bitrix/www` validates the patched workflow without changing it. Review a notification dry run before enabling delivery. Then run `configure.php apply /home/bitrix/www /private/backup/directory` to back up and update only template 217, and register the notification agent. The command is idempotent.

To restore, disable the integration agent and restore template 217 using the saved configuration, then restore the original files from that same backup. The integration does not delete or change existing task/report data on installation.

## Verification

Run the standalone PHP tests in `tests/` and lint every PHP file. The tests cover the guard's winner selection, exact previous-stage recovery and stale transitions, as well as Moscow time, weekdays, notification routing, deduplication, threshold crossings and workflow preservation.

Production checks should use read-only task inspection and notification dry runs. Do not move real employee tasks or send fabricated test alerts to verify installation. Verify the actual business-process designer shows the guard before the preserved actions, and the agent registry shows a 60-second interval.

The guard runs after CRM saves the requested stage transition. It performs a synchronous rollback rather than blocking the initial save. Changing a responsible employee while a task remains In work is outside this stage-entry robot's scope. Existing duplicate In-work tasks are not moved retroactively.

Transient failures with a verified transition are retried by a second minute-based agent, bound to the original history entry. A successful delayed check resumes the preserved stage workflow once. Unknown history or an ambiguous workflow start produces a visible diagnostic instead of cancelling a newer transition or replaying existing actions.
