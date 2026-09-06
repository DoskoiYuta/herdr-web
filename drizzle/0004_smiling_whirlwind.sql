CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`spec` text NOT NULL,
	`answer` text,
	`pane_id` text,
	`claude_session_id` text,
	`worktree_root` text,
	`repo_key` text,
	`agent` text,
	`created_at` text NOT NULL,
	`answered_at` text,
	`delivery` text
);
--> statement-breakpoint
CREATE INDEX `decisions_status_idx` ON `decisions` (`status`);--> statement-breakpoint
CREATE INDEX `decisions_worktree_root_idx` ON `decisions` (`worktree_root`);