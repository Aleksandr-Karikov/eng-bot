ALTER TABLE `users` ADD `capture_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_capture_key_unique` ON `users` (`capture_key`);