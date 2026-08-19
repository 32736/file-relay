-- Shares: store the raw token encrypted with the Worker secret so the owner
-- can recover share links on any logged-in device. The raw token is never
-- stored in plaintext (AES-GCM, see server/lib/crypto.ts).
ALTER TABLE `shares` ADD `encrypted_token` TEXT;
