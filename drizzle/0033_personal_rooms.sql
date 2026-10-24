-- Личный словарь «Мои слова» каждому, у кого его ещё нет (раньше заводился только по необходимости).
INSERT INTO `rooms` (`name`, `invite_code`, `created_by`, `created_at`, `personal_of`, `weekly_goal`)
SELECT 'Мои слова', lower(hex(randomblob(6))), `u`.`id`, CAST(strftime('%s', 'now') AS INTEGER) * 1000, `u`.`id`, 0
FROM `users` `u`
WHERE NOT EXISTS (SELECT 1 FROM `rooms` `r` WHERE `r`.`personal_of` = `u`.`id`);
--> statement-breakpoint
INSERT INTO `room_members` (`room_id`, `user_id`, `joined_at`)
SELECT `r`.`id`, `r`.`personal_of`, `r`.`created_at`
FROM `rooms` `r`
WHERE `r`.`personal_of` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `room_members` `m` WHERE `m`.`room_id` = `r`.`id` AND `m`.`user_id` = `r`.`personal_of`);
--> statement-breakpoint
-- Без текущей комнаты — личный словарь становится текущим (у остальных текущая не меняется).
UPDATE `users`
SET `current_room_id` = (SELECT `r`.`id` FROM `rooms` `r` WHERE `r`.`personal_of` = `users`.`id`)
WHERE `current_room_id` IS NULL;
