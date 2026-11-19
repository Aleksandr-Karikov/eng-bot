ALTER TABLE `combat_spends` ADD `boss_damage_deci` integer;--> statement-breakpoint
ALTER TABLE `combat_spends` ADD `core_week` text;--> statement-breakpoint
ALTER TABLE `combat_spends` ADD `rune_serial` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `combat_spends_core_idx` ON `combat_spends` (`user_id`,`room_id`,`core_week`);--> statement-breakpoint
CREATE UNIQUE INDEX `combat_spends_rune_idx` ON `combat_spends` (`user_id`,`rune_serial`);--> statement-breakpoint
ALTER TABLE `users` ADD `runes_bought` integer DEFAULT 0 NOT NULL;