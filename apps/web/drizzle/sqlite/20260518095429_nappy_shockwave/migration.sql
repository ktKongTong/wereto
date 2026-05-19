CREATE TABLE `albums` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`weread_album_id` text NOT NULL,
	`name` text NOT NULL,
	`author_name` text,
	`cover` text,
	`track_count` integer,
	`finish_status` text,
	`intro` text,
	`raw_json` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_config` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
INSERT INTO `app_config` (`key`, `value`, `updated_at`)
VALUES ('auth.password', 'weread', 0);
INSERT INTO `app_config` (`key`, `value`, `updated_at`)
VALUES ('auth.passwordChanged', 'false', 0);
INSERT INTO `app_config` (`key`, `value`, `updated_at`)
VALUES ('site.public', 'true', 0);
--> statement-breakpoint
CREATE TABLE `book_info` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`book_id` integer NOT NULL,
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
	`raw_json` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `book_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`book_id` integer NOT NULL,
	`chapter_uid` integer,
	`chapter_offset` integer,
	`progress` integer,
	`record_reading_time` integer,
	`finish_time` integer,
	`is_start_reading` integer,
	`source_update_time` integer,
	`source_timestamp` integer,
	`raw_json` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `books` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
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
	`raw_json` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `highlights` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`book_id` integer NOT NULL,
	`weread_bookmark_id` text NOT NULL,
	`chapter_uid` integer,
	`chapter_title` text,
	`range` text,
	`mark_text` text NOT NULL,
	`color_style` integer,
	`create_time` integer NOT NULL,
	`raw_json` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notebook_books` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`book_id` integer NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	`note_count` integer DEFAULT 0 NOT NULL,
	`bookmark_count` integer DEFAULT 0 NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`reading_progress` integer,
	`marked_status` integer,
	`sort` integer DEFAULT 0 NOT NULL,
	`raw_json` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `read_books` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`book_id` integer NOT NULL,
	`first_seen_period_start` text NOT NULL,
	`last_seen_period_start` text NOT NULL,
	`total_read_time` integer DEFAULT 0 NOT NULL,
	`seen_periods` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'weekly_read_longest' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reading_days` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`year` integer NOT NULL,
	`day` text NOT NULL,
	`read_seconds` integer DEFAULT 0 NOT NULL,
	`source` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reading_period_books` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`period_id` integer NOT NULL,
	`book_id` integer,
	`album_id` integer,
	`rank` integer NOT NULL,
	`read_time` integer DEFAULT 0 NOT NULL,
	`record_reading_time` integer DEFAULT 0 NOT NULL,
	`tags_json` text,
	`title_snapshot` text NOT NULL,
	`author_snapshot` text,
	`cover_snapshot` text,
	`raw_json` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reading_periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
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
	`raw_json` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reading_top_books` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`year` integer NOT NULL,
	`book_id` integer,
	`album_id` integer,
	`rank` integer NOT NULL,
	`read_time` integer DEFAULT 0 NOT NULL,
	`record_reading_time` integer DEFAULT 0 NOT NULL,
	`tags_json` text,
	`title_snapshot` text NOT NULL,
	`author_snapshot` text,
	`cover_snapshot` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reading_years` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`year` integer NOT NULL,
	`total_read_time` integer DEFAULT 0 NOT NULL,
	`read_days` integer DEFAULT 0 NOT NULL,
	`day_average_read_time` integer DEFAULT 0 NOT NULL,
	`compare_basis_points` integer,
	`raw_json` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`book_id` integer NOT NULL,
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
	`raw_json` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shelf_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`item_type` text NOT NULL,
	`book_id` integer,
	`album_id` integer,
	`title_snapshot` text NOT NULL,
	`author_snapshot` text,
	`cover_snapshot` text,
	`category_snapshot` text,
	`is_top` integer DEFAULT 0 NOT NULL,
	`is_secret` integer DEFAULT 0 NOT NULL,
	`finish_reading` integer DEFAULT 0 NOT NULL,
	`read_update_time` integer,
	`source_update_time` integer,
	`raw_json` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_cursors` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_run_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` integer NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`phase` text NOT NULL,
	`message` text NOT NULL,
	`progress_current` integer,
	`progress_total` integer,
	`meta_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`task_type` text DEFAULT 'weread_sync' NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`phase` text DEFAULT 'queued' NOT NULL,
	`requested_at` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`updated_at` integer DEFAULT 0 NOT NULL,
	`progress_current` integer DEFAULT 0 NOT NULL,
	`progress_total` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`result_json` text,
	`stats_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `albums_weread_album_id_idx` ON `albums` (`weread_album_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `book_info_book_id_idx` ON `book_info` (`book_id`);--> statement-breakpoint
CREATE INDEX `book_info_title_idx` ON `book_info` (`title`);--> statement-breakpoint
CREATE INDEX `book_info_author_idx` ON `book_info` (`author`);--> statement-breakpoint
CREATE UNIQUE INDEX `book_progress_book_id_idx` ON `book_progress` (`book_id`);--> statement-breakpoint
CREATE INDEX `book_progress_update_time_idx` ON `book_progress` (`source_update_time`);--> statement-breakpoint
CREATE UNIQUE INDEX `books_weread_book_id_idx` ON `books` (`weread_book_id`);--> statement-breakpoint
CREATE INDEX `books_title_idx` ON `books` (`title`);--> statement-breakpoint
CREATE INDEX `books_author_idx` ON `books` (`author`);--> statement-breakpoint
CREATE UNIQUE INDEX `highlights_weread_bookmark_id_idx` ON `highlights` (`weread_bookmark_id`);--> statement-breakpoint
CREATE INDEX `highlights_book_id_create_time_idx` ON `highlights` (`book_id`,`create_time`);--> statement-breakpoint
CREATE UNIQUE INDEX `notebook_books_book_id_idx` ON `notebook_books` (`book_id`);--> statement-breakpoint
CREATE INDEX `notebook_books_total_count_idx` ON `notebook_books` (`total_count`);--> statement-breakpoint
CREATE INDEX `notebook_books_sort_idx` ON `notebook_books` (`sort`);--> statement-breakpoint
CREATE UNIQUE INDEX `read_books_book_id_idx` ON `read_books` (`book_id`);--> statement-breakpoint
CREATE INDEX `read_books_last_seen_idx` ON `read_books` (`last_seen_period_start`);--> statement-breakpoint
CREATE INDEX `read_books_total_read_time_idx` ON `read_books` (`total_read_time`);--> statement-breakpoint
CREATE UNIQUE INDEX `reading_days_year_day_idx` ON `reading_days` (`year`,`day`);--> statement-breakpoint
CREATE INDEX `reading_days_year_read_seconds_idx` ON `reading_days` (`year`,`read_seconds`);--> statement-breakpoint
CREATE UNIQUE INDEX `reading_period_books_period_rank_idx` ON `reading_period_books` (`period_id`,`rank`);--> statement-breakpoint
CREATE INDEX `reading_period_books_book_idx` ON `reading_period_books` (`book_id`);--> statement-breakpoint
CREATE INDEX `reading_period_books_album_idx` ON `reading_period_books` (`album_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reading_periods_type_start_idx` ON `reading_periods` (`period_type`,`period_start`);--> statement-breakpoint
CREATE INDEX `reading_periods_type_base_time_idx` ON `reading_periods` (`period_type`,`base_time`);--> statement-breakpoint
CREATE UNIQUE INDEX `reading_top_books_year_rank_idx` ON `reading_top_books` (`year`,`rank`);--> statement-breakpoint
CREATE INDEX `reading_top_books_year_idx` ON `reading_top_books` (`year`);--> statement-breakpoint
CREATE UNIQUE INDEX `reading_years_year_idx` ON `reading_years` (`year`);--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_weread_review_id_idx` ON `reviews` (`weread_review_id`);--> statement-breakpoint
CREATE INDEX `reviews_book_id_create_time_idx` ON `reviews` (`book_id`,`create_time`);--> statement-breakpoint
CREATE INDEX `reviews_review_type_idx` ON `reviews` (`review_type`);--> statement-breakpoint
CREATE INDEX `shelf_items_type_idx` ON `shelf_items` (`item_type`);--> statement-breakpoint
CREATE INDEX `shelf_items_read_update_time_idx` ON `shelf_items` (`read_update_time`);--> statement-breakpoint
CREATE INDEX `sync_run_logs_run_created_idx` ON `sync_run_logs` (`run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sync_run_logs_level_idx` ON `sync_run_logs` (`level`);--> statement-breakpoint
CREATE INDEX `sync_runs_source_idx` ON `sync_runs` (`source`,`started_at`);--> statement-breakpoint
CREATE INDEX `sync_runs_status_idx` ON `sync_runs` (`status`,`updated_at`);
