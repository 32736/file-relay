CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`password_mac` text,
	`expires_at` integer,
	`max_downloads` integer,
	`download_count` integer DEFAULT 0 NOT NULL,
	`last_download_at` integer,
	`delete_file_after_exhausted` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_token_hash_unique` ON `shares` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_shares_expires_at` ON `shares` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_shares_file_id` ON `shares` (`file_id`);