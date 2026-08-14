CREATE TABLE `upload_parts` (
	`upload_session_id` text NOT NULL,
	`part_number` integer NOT NULL,
	`etag` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`upload_session_id`, `part_number`)
);
--> statement-breakpoint
CREATE INDEX `idx_upload_parts_session` ON `upload_parts` (`upload_session_id`);