ALTER TABLE `reviews` ADD `notify_state` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `reviews` ADD `notify_pane` text;--> statement-breakpoint
ALTER TABLE `reviews` ADD `notify_at` text;