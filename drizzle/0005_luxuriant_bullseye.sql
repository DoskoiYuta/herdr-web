CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_key` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notes_repo_key_idx` ON `notes` (`repo_key`);