ALTER TABLE `books` ADD `translator` text;--> statement-breakpoint
ALTER TABLE `books` ADD `publish_time` text;--> statement-breakpoint
ALTER TABLE `books` ADD `rating_detail_json` text;--> statement-breakpoint
ALTER TABLE `sync_snapshot_books` ADD `translator` text;--> statement-breakpoint
ALTER TABLE `sync_snapshot_books` ADD `publish_time` text;--> statement-breakpoint
ALTER TABLE `sync_snapshot_books` ADD `rating_detail_json` text;--> statement-breakpoint
DROP INDEX IF EXISTS `book_info_book_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `book_info_title_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `book_info_author_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `sync_snapshot_book_info_run_book_idx`;--> statement-breakpoint
DROP TABLE `book_info`;--> statement-breakpoint
DROP TABLE `sync_snapshot_book_info`;
