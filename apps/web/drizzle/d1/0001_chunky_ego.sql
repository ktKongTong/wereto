CREATE TABLE `sync_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`target_table` text NOT NULL,
	`entity_key` text NOT NULL,
	`operation` text DEFAULT 'upsert' NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_snapshots_run_target_key_idx` ON `sync_snapshots` (`run_id`,`target_table`,`entity_key`);--> statement-breakpoint
CREATE INDEX `sync_snapshots_run_idx` ON `sync_snapshots` (`run_id`);--> statement-breakpoint
CREATE INDEX `sync_snapshots_target_idx` ON `sync_snapshots` (`target_table`);