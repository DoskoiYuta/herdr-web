CREATE TABLE `workspace_worktree_selections` (
	`workspace_id` text NOT NULL,
	`repo_key` text NOT NULL,
	`worktree_root` text NOT NULL,
	`sub_repo_id` text,
	`sub_worktree_root` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `repo_key`)
);
--> statement-breakpoint
DROP TABLE `pane_worktree_overrides`;