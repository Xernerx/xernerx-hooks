/**
 * `@xernerx/hooks` — Official Xernerx Webhook Receiver & User Engagement Cache (`voted`, `reviewed`, `tipped`).
 *
 * @packageDocumentation
 * @format
 */

import { BaseClient, type BaseClientOptions } from './client/BaseClient.js';
import { HooksClient, type HooksClientOptions } from './client/HooksClient.js';
import { XernerxHooks, type XernerxHooksOptions } from './client/XernerxHooks.js';
import type {
	HooksEvents,
	RawWebhookEnvelope,
	RawWebhookEventName,
	ReleaseWebhookPayload,
	ReviewWebhookPayload,
	StatWebhookPayload,
	TestWebhookPayload,
	TipWebhookPayload,
	UserEngagementState,
	VoteWebhookPayload,
	WebhookEventName,
	WebhookEventPayload,
} from './types/webhooks.js';

export { XernerxHooks, HooksClient, BaseClient };
export type {
	XernerxHooksOptions,
	HooksClientOptions,
	BaseClientOptions,
	UserEngagementState,
	RawWebhookEnvelope,
	RawWebhookEventName,
	WebhookEventName,
	VoteWebhookPayload,
	ReviewWebhookPayload,
	TipWebhookPayload,
	ReleaseWebhookPayload,
	StatWebhookPayload,
	TestWebhookPayload,
	WebhookEventPayload,
	HooksEvents,
};
