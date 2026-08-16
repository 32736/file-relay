CREATE TABLE `owner_emails` (
  `github_user_id` text PRIMARY KEY NOT NULL,
  `encrypted_email` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `magic_link_tokens` (
  `id` text PRIMARY KEY NOT NULL,
  `token_hash` text NOT NULL UNIQUE,
  `github_user_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `consumed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_magic_link_tokens_expires_at` ON `magic_link_tokens` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_magic_link_tokens_owner_created` ON `magic_link_tokens` (`github_user_id`, `created_at`);
