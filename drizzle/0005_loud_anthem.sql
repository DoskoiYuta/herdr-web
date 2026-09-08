CREATE TABLE `pane_worktree_overrides` (
	`pane_id` text PRIMARY KEY NOT NULL,
	`root` text NOT NULL,
	`observed_cwd` text,
	`set_at` text NOT NULL
);
