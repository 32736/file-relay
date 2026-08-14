CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text,
	`size` integer NOT NULL,
	`etag` text,
	`source` text DEFAULT 'owner' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_object_key_unique` ON `files` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_files_created_at` ON `files` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_files_expires_at` ON `files` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_files_deleted_at` ON `files` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`object_key` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text,
	`total_size` integer NOT NULL,
	`chunk_size` integer NOT NULL,
	`total_parts` integer NOT NULL,
	`mode` text NOT NULL,
	`r2_upload_id` text,
	`auth_kind` text NOT NULL,
	`access_token_hash` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upload_sessions_object_key_unique` ON `upload_sessions` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_upload_sessions_status` ON `upload_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_upload_sessions_expires_at` ON `upload_sessions` (`expires_at`);