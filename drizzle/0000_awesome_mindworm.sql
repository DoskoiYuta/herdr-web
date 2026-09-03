CREATE TABLE `repos` (
	`key` text PRIMARY KEY NOT NULL,
	`root_commit` text,
	`name` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `review_entries` (
	`review_id` text NOT NULL,
	`seq` integer NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`at` text NOT NULL,
	`agent_session` text,
	PRIMARY KEY(`review_id`, `seq`),
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_value` text NOT NULL,
	`worktree_root` text NOT NULL,
	`path` text NOT NULL,
	`anchor` text NOT NULL,
	`created_at_head` text NOT NULL,
	`viewed_from` text NOT NULL,
	`viewed_to` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reviews_repo_status_idx` ON `reviews` (`repo`,`status`);--> statement-breakpoint
CREATE INDEX `reviews_target_idx` ON `reviews` (`target_kind`,`target_value`);