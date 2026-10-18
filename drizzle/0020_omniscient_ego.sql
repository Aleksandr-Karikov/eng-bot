ALTER TABLE `users` ADD `mode_collocation` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `words` ADD `collocations` text DEFAULT '' NOT NULL;