-- Store the expiration selected for the completed file separately from the
-- short-lived upload session expiration.
ALTER TABLE `upload_sessions` ADD `file_expires_at` integer;
