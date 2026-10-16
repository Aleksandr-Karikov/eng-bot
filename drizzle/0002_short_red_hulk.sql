CREATE TABLE `cloze_sentences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word_id` integer NOT NULL,
	`sentence` text NOT NULL,
	`answer` text NOT NULL,
	`translation` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `users` ADD `mode_en_ru` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `mode_ru_en` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `mode_cloze` integer DEFAULT true NOT NULL;