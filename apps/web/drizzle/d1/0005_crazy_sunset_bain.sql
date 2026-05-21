PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`task_type` text DEFAULT 'weread_sync' NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`phase` text DEFAULT 'queued' NOT NULL,
	`requested_at` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`updated_at` integer DEFAULT 0 NOT NULL,
	`progress_current` integer DEFAULT 0 NOT NULL,
	`progress_total` integer DEFAULT 0 NOT NULL,
	`workflow_instance_id` text,
	`error_message` text,
	`result_json` text,
	`stats_json` text
);
--> statement-breakpoint
INSERT INTO `__new_sync_runs`(`id`, `task_type`, `source`, `status`, `phase`, `requested_at`, `started_at`, `finished_at`, `updated_at`, `progress_current`, `progress_total`, `workflow_instance_id`, `error_message`, `result_json`, `stats_json`) SELECT `id`, `task_type`, `source`, `status`, `phase`, `requested_at`, `started_at`, `finished_at`, `updated_at`, `progress_current`, `progress_total`, `workflow_instance_id`, `error_message`, `result_json`, `stats_json` FROM `sync_runs`;--> statement-breakpoint
DROP TABLE `sync_runs`;--> statement-breakpoint
ALTER TABLE `__new_sync_runs` RENAME TO `sync_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `sync_runs_source_idx` ON `sync_runs` (`source`,`started_at`);--> statement-breakpoint
CREATE INDEX `sync_runs_status_idx` ON `sync_runs` (`status`,`updated_at`);