CREATE TABLE `sync_stage_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`stage` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`offset` integer NOT NULL,
	`size` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`result_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_stage_chunks_run_stage_chunk_idx` ON `sync_stage_chunks` (`run_id`,`stage`,`chunk_index`);--> statement-breakpoint
CREATE INDEX `sync_stage_chunks_run_stage_status_idx` ON `sync_stage_chunks` (`run_id`,`stage`,`status`);