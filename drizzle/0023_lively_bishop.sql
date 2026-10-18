CREATE TABLE `pending_exercises` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`since` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
