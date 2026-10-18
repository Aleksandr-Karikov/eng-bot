ALTER TABLE `users` ADD `notify_due` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `last_due_notice_at` integer;