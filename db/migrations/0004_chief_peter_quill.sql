CREATE TABLE `incoming_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`title` text,
	`expires_at` integer NOT NULL,
	`max_file_size` integer NOT NULL,
	`max_files` integer NOT NULL,
	`uploaded_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incoming_requests_token_hash_unique` ON `incoming_requests` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_incoming_expires_at` ON `incoming_requests` (`expires_at`);