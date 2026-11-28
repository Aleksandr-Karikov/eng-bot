CREATE TABLE `word_guess_progress` (
	`card_id` integer PRIMARY KEY NOT NULL,
	`attempts` integer,
	`played_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
