DROP TABLE IF EXISTS `incoming_requests`;
--> statement-breakpoint
ALTER TABLE `files` DROP COLUMN `source`;
--> statement-breakpoint
ALTER TABLE `files` DROP COLUMN `encrypted`;
--> statement-breakpoint
ALTER TABLE `files` DROP COLUMN `encrypted_header`;
--> statement-breakpoint
ALTER TABLE `upload_sessions` DROP COLUMN `auth_kind`;
--> statement-breakpoint
ALTER TABLE `upload_sessions` DROP COLUMN `access_token_hash`;
--> statement-breakpoint
ALTER TABLE `upload_sessions` DROP COLUMN `encrypted`;
--> statement-breakpoint
ALTER TABLE `upload_sessions` DROP COLUMN `encrypted_header`;
--> statement-breakpoint
ALTER TABLE `shares` DROP COLUMN `password_mac`;
--> statement-breakpoint
ALTER TABLE `shares` DROP COLUMN `wrapped_key`;
