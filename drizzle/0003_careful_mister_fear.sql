CREATE TABLE `ask_entries` (
	`ask_id` text NOT NULL,
	`seq` integer NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`at` text NOT NULL,
	`agent_session` text,
	PRIMARY KEY(`ask_id`, `seq`),
	FOREIGN KEY (`ask_id`) REFERENCES `asks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `asks` (
	`id` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`worktree_root` text NOT NULL,
	`path` text NOT NULL,
	`anchor` text NOT NULL,
	`created_at_head` text,
	`status` text NOT NULL,
	`session` text,
	`last_prompt_state` text,
	`last_prompt_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `asks_repo_status_idx` ON `asks` (`repo`,`status`);--> statement-breakpoint
CREATE INDEX `asks_repo_worktree_path_idx` ON `asks` (`repo`,`worktree_root`,`path`);