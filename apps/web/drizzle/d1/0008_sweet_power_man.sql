ALTER TABLE `sync_run_logs` ADD `seq` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `sync_run_logs_run_seq_idx` ON `sync_run_logs` (`run_id`,`seq`);