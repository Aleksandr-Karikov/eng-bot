ALTER TABLE `rooms` ADD `language` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `personal_owner` integer REFERENCES users(id);--> statement-breakpoint
-- Существующие личные словари — английские: переносим отметку владельца в новую колонку (старая остаётся как была).
UPDATE `rooms` SET `personal_owner` = `personal_of` WHERE `personal_of` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_personal_lang_idx` ON `rooms` (`personal_owner`,`language`);--> statement-breakpoint
ALTER TABLE `word_sets` ADD `language` text DEFAULT 'en' NOT NULL;