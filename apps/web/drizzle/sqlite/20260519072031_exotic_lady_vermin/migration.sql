CREATE TABLE `sync_snapshot_albums` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`weread_album_id` text NOT NULL,
	`name` text NOT NULL,
	`author_name` text,
	`cover` text,
	`track_count` integer,
	`finish_status` text,
	`intro` text,
	`raw_json` text
);
--> statement-breakpoint
CREATE TABLE `sync_snapshot_book_info` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`weread_book_id` text NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`translator` text,
	`cover` text,
	`intro` text,
	`category` text,
	`publisher` text,
	`publish_time` text,
	`isbn` text,
	`word_count` integer,
	`rating` integer,
	`rating_count` integer,
	`rating_detail_json` text,
	`raw_json` text
);
--> statement-breakpoint
CREATE TABLE `sync_snapshot_book_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`weread_book_id` text NOT NULL,
	`chapter_uid` integer,
	`chapter_offset` integer,
	`progress` integer,
	`record_reading_time` integer,
	`finish_time` integer,
	`is_start_reading` integer,
	`source_update_time` integer,
	`source_timestamp` integer,
	`raw_json` text
);
--> statement-breakpoint
CREATE TABLE `sync_snapshot_books` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`weread_book_id` text NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`cover` text,
	`intro` text,
	`category` text,
	`publisher` text,
	`isbn` text,
	`word_count` integer,
	`rating` integer,
	`rating_count` integer,
	`raw_json` text
);
--> statement-breakpoint
CREATE TABLE `sync_snapshot_cursors` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_snapshot_highlights` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`weread_book_id` text NOT NULL,
	`weread_bookmark_id` text NOT NULL,
	`chapter_uid` integer,
	`chapter_title` text,
	`range` text,
	`mark_text` text NOT NULL,
	`color_style` integer,
	`create_time` integer NOT NULL,
	`raw_json` text
);
--> statement-breakpoint
CREATE TABLE `sync_snapshot_notebook_books` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`weread_book_id` text NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	`note_count` integer DEFAULT 0 NOT NULL,
	`bookmark_count` integer DEFAULT 0 NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`reading_progress` integer,
	`marked_status` integer,
	`sort` integer DEFAULT 0 NOT NULL,
	`raw_json` text
);
--> statement-breakpoint
CREATE TABLE `sync_snapshot_reading_days` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`year` integer NOT NULL,
	`day` text NOT NULL,
	`read_seconds` integer DEFAULT 0 NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_snapshot_reading_period_books` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`period_key` text NOT NULL,
	`weread_book_id` text,
	`weread_album_id` text,
	`rank` integer NOT NULL,
	`read_time` integer DEFAULT 0 NOT NULL,
	`record_reading_time` integer DEFAULT 0 NOT NULL,
	`tags_json` text,
	`title_snapshot` text NOT NULL,
	`author_snapshot` text,
	`cover_snapshot` text,
	`raw_json` text
);
--> statement-breakpoint
CREATE TABLE `sync_snapshot_reading_periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`period_type` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text,
	`base_time` integer NOT NULL,
	`total_read_time` integer DEFAULT 0 NOT NULL,
	`read_days` integer DEFAULT 0 NOT NULL,
	`day_average_read_time` integer DEFAULT 0 NOT NULL,
	`compare_basis_points` integer,
	`read_times_json` text,
	`read_stat_json` text,
	`raw_json` text
);
--> statement-breakpoint
CREATE TABLE `sync_snapshot_reading_top_books` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`year` integer NOT NULL,
	`weread_book_id` text,
	`weread_album_id` text,
	`rank` integer NOT NULL,
	`read_time` integer DEFAULT 0 NOT NULL,
	`record_reading_time` integer DEFAULT 0 NOT NULL,
	`tags_json` text,
	`title_snapshot` text NOT NULL,
	`author_snapshot` text,
	`cover_snapshot` text
);
--> statement-breakpoint
CREATE TABLE `sync_snapshot_reading_years` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`year` integer NOT NULL,
	`total_read_time` integer DEFAULT 0 NOT NULL,
	`read_days` integer DEFAULT 0 NOT NULL,
	`day_average_read_time` integer DEFAULT 0 NOT NULL,
	`compare_basis_points` integer,
	`raw_json` text
);
--> statement-breakpoint
CREATE TABLE `sync_snapshot_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`weread_book_id` text NOT NULL,
	`weread_review_id` text NOT NULL,
	`chapter_uid` integer,
	`chapter_name` text,
	`range` text,
	`abstract` text,
	`content` text NOT NULL,
	`star` integer,
	`is_finish` integer,
	`review_type` text DEFAULT 'unknown' NOT NULL,
	`create_time` integer NOT NULL,
	`raw_json` text
);
--> statement-breakpoint
CREATE TABLE `sync_snapshot_shelf_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`entity_key` text NOT NULL,
	`item_type` text NOT NULL,
	`weread_book_id` text,
	`weread_album_id` text,
	`title_snapshot` text NOT NULL,
	`author_snapshot` text,
	`cover_snapshot` text,
	`category_snapshot` text,
	`is_top` integer DEFAULT 0 NOT NULL,
	`is_secret` integer DEFAULT 0 NOT NULL,
	`finish_reading` integer DEFAULT 0 NOT NULL,
	`read_update_time` integer,
	`source_update_time` integer,
	`raw_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_snapshot_albums_run_album_idx` ON `sync_snapshot_albums` (`run_id`,`weread_album_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_snapshot_book_info_run_book_idx` ON `sync_snapshot_book_info` (`run_id`,`weread_book_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_snapshot_book_progress_run_book_idx` ON `sync_snapshot_book_progress` (`run_id`,`weread_book_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_snapshot_books_run_book_idx` ON `sync_snapshot_books` (`run_id`,`weread_book_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_snapshot_cursors_run_key_idx` ON `sync_snapshot_cursors` (`run_id`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_snapshot_highlights_run_bookmark_idx` ON `sync_snapshot_highlights` (`run_id`,`weread_bookmark_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_snapshot_notebook_books_run_book_idx` ON `sync_snapshot_notebook_books` (`run_id`,`weread_book_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_snapshot_reading_days_run_day_idx` ON `sync_snapshot_reading_days` (`run_id`,`year`,`day`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_snapshot_reading_period_books_run_period_rank_idx` ON `sync_snapshot_reading_period_books` (`run_id`,`period_key`,`rank`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_snapshot_reading_periods_run_period_idx` ON `sync_snapshot_reading_periods` (`run_id`,`period_type`,`period_start`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_snapshot_reading_top_books_run_year_rank_idx` ON `sync_snapshot_reading_top_books` (`run_id`,`year`,`rank`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_snapshot_reading_years_run_year_idx` ON `sync_snapshot_reading_years` (`run_id`,`year`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_snapshot_reviews_run_review_idx` ON `sync_snapshot_reviews` (`run_id`,`weread_review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_snapshot_shelf_items_run_key_idx` ON `sync_snapshot_shelf_items` (`run_id`,`entity_key`);