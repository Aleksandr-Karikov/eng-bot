CREATE TABLE `storm_starts` (
	`card_id` integer PRIMARY KEY NOT NULL,
	`trigger_log_id` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
