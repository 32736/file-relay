ALTER TABLE `upload_sessions` ADD `encrypted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `upload_sessions` ADD `encrypted_header` text;