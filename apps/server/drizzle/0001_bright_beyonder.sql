CREATE TABLE `issue_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`role` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`attachments_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issue_chat_threads`(`issue_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issue_chat_messages_issue_created_idx` ON `issue_chat_messages` (`issue_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `issue_chat_threads` (
	`issue_id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issue_chat_threads_document_updated_idx` ON `issue_chat_threads` (`document_id`,`updated_at`);