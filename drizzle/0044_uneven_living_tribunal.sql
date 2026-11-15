ALTER TABLE `words` ADD `part_of_speech` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `words` ADD `cefr` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `words` ADD `forms` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `words` ADD `synonyms` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `words` ADD `antonyms` text DEFAULT '[]' NOT NULL;