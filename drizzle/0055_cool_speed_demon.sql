ALTER TABLE `rooms` ADD `timezone` text DEFAULT 'Asia/Novosibirsk' NOT NULL;--> statement-breakpoint
UPDATE `rooms`
SET `timezone` = (SELECT `timezone` FROM `users` WHERE `users`.`id` = `rooms`.`created_by`)
WHERE EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = `rooms`.`created_by`);
