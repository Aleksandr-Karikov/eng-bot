CREATE TABLE `meeting_polls` (
	`chat_id` integer PRIMARY KEY NOT NULL,
	`time` text,
	`timezone` text NOT NULL,
	`options` text NOT NULL,
	`last_sent_at` integer
);
