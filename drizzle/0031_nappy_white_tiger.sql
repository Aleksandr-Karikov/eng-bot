ALTER TABLE `rooms` ADD `personal_of` integer REFERENCES users(id);--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_personal_of_unique` ON `rooms` (`personal_of`);