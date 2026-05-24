CREATE TABLE `api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_idx` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_revoked_at_idx` ON `api_keys` (`revoked_at`);