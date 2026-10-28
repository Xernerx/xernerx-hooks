/** @format */

/**
 * Cached engagement state for a Discord user relative to a specific bot on Xernerx.
 */
export interface UserEngagementState {
	/**
	 * Discord user snowflake ID.
	 */
	userId: string;

	/**
	 * Discord bot snowflake ID.
	 */
	botId: string;

	/**
	 * Whether the user currently has an active vote within the 12-hour voting window.
	 */
	voted: boolean;

	/**
	 * ISO-8601 timestamp of when the user last voted, or `null` if never voted.
	 */
	lastVotedAt: string | null;

	/**
	 * ISO-8601 timestamp of when the user's current vote expires and they can vote again, or `null`.
	 */
	nextVoteAt: string | null;

	/**
	 * Whether the user has published an active review for the bot.
	 */
	reviewed: boolean;

	/**
	 * Star rating (`1`–`5`) given in the user's review, or `null` if not reviewed.
	 */
	rating: number | null;

	/**
	 * Total credit amount tipped by the user (`0` if the user has not tipped, `> 0` if tipped).
	 */
	tipped: number;

	/**
	 * Unix timestamp in milliseconds when this cache entry was last updated.
	 */
	updatedAt: number;
}

/**
 * Raw webhook event identifier sent in the `X-Xernerx-Event` HTTP header by `api.xernerx.com`.
 */
export type RawWebhookEventName =
	'POST vote' | 'POST review' | 'PATCH review' | 'DELETE review' | 'VOTE review' | 'POST tip' | 'POST release' | 'POST stat' | 'PATCH stat' | 'DELETE stat' | 'TEST ping';

/**
 * Normalized event name emitted by {@link HooksClient} and {@link XernerxHooks}.
 */
export type WebhookEventName = 'vote' | 'review' | 'tip' | 'release' | 'stat' | 'test' | 'webhook';

/**
 * Raw JSON envelope delivered by `api.xernerx.com` webhook requests.
 */
export interface RawWebhookEnvelope {
	/**
	 * Optional raw webhook event name (`'POST vote'`, `'POST review'`, `'POST tip'`, etc.).
	 */
	event?: RawWebhookEventName | string;

	/**
	 * Optional Discord bot snowflake ID.
	 */
	botId?: string;

	/**
	 * Optional Discord user snowflake ID.
	 */
	userId?: string;

	/**
	 * Optional ISO-8601 timestamp of the webhook delivery.
	 */
	timestamp?: string;

	/**
	 * Structured event data object when sent in envelope format.
	 */
	data?: Record<string, any>;

	/**
	 * Optional Discord-formatted embed array for legacy webhook payloads.
	 */
	embeds?: Array<Record<string, any>>;
}

/**
 * Payload emitted for `'vote'` (`POST vote`) webhook events.
 */
export interface VoteWebhookPayload {
	/**
	 * Raw webhook event type (`'POST vote'`).
	 */
	event: 'POST vote';

	/**
	 * Discord bot snowflake ID that received the vote.
	 */
	botId: string;

	/**
	 * Discord user snowflake ID who cast the vote.
	 */
	userId: string;

	/**
	 * Always `true` when a vote is recorded.
	 */
	voted: boolean;

	/**
	 * ISO-8601 timestamp when the vote was cast.
	 */
	votedAt: string;

	/**
	 * ISO-8601 timestamp when the user can vote again (12 hours after `votedAt`).
	 */
	nextVoteAt: string;

	/**
	 * Optional updated total vote count for the bot.
	 */
	totalVotes?: number;

	/**
	 * Optional current voting streak for the user.
	 */
	streak?: number;

	/**
	 * Updated cached engagement state for the user.
	 */
	engagement: UserEngagementState;

	/**
	 * Resolved Discord `User` or `XernerxUser` instance when running with {@link XernerxHooks}.
	 */
	user?: any;

	/**
	 * Raw JSON body received from the webhook request.
	 */
	raw: Record<string, any>;
}

/**
 * Payload emitted for `'review'` (`POST review`, `PATCH review`, `DELETE review`, `VOTE review`) webhook events.
 */
export interface ReviewWebhookPayload {
	/**
	 * Raw webhook event type.
	 */
	event: 'POST review' | 'PATCH review' | 'DELETE review' | 'VOTE review';

	/**
	 * Normalized review lifecycle action.
	 */
	action: 'created' | 'updated' | 'deleted' | 'voted';

	/**
	 * Discord bot snowflake ID that received the review action.
	 */
	botId: string;

	/**
	 * Discord user snowflake ID associated with the review.
	 */
	userId: string;

	/**
	 * Optional unique identifier of the review document.
	 */
	reviewId?: string;

	/**
	 * Star rating (`1`–`5`) for created/updated reviews, or `null` when deleted.
	 */
	rating: number | null;

	/**
	 * Optional text content of the review.
	 */
	content?: string | null;

	/**
	 * Whether the user currently has an active review on the bot (`false` after deletion).
	 */
	reviewed: boolean;

	/**
	 * ISO-8601 timestamp of the review event.
	 */
	timestamp: string;

	/**
	 * Updated cached engagement state for the user.
	 */
	engagement: UserEngagementState;

	/**
	 * Resolved Discord `User` or `XernerxUser` instance when running with {@link XernerxHooks}.
	 */
	user?: any;

	/**
	 * Raw JSON body received from the webhook request.
	 */
	raw: Record<string, any>;
}

/**
 * Payload emitted for `'tip'` (`POST tip`) webhook events.
 */
export interface TipWebhookPayload {
	/**
	 * Raw webhook event type (`'POST tip'`).
	 */
	event: 'POST tip';

	/**
	 * Discord bot snowflake ID that received the tip.
	 */
	botId: string;

	/**
	 * Discord user snowflake ID who sent the tip.
	 */
	userId: string;

	/**
	 * Credit amount tipped in this transaction.
	 */
	amount: number;

	/**
	 * Cumulative credit amount tipped by this user for this bot.
	 */
	totalTipped: number;

	/**
	 * Alias for `totalTipped` (`> 0` credit amount).
	 */
	tipped: number;

	/**
	 * Optional message attached to the tip.
	 */
	message?: string | null;

	/**
	 * ISO-8601 timestamp of the tip event.
	 */
	timestamp: string;

	/**
	 * Updated cached engagement state for the user.
	 */
	engagement: UserEngagementState;

	/**
	 * Resolved Discord `User` or `XernerxUser` instance when running with {@link XernerxHooks}.
	 */
	user?: any;

	/**
	 * Raw JSON body received from the webhook request.
	 */
	raw: Record<string, any>;
}

/**
 * Payload emitted for `'release'` (`POST release`) webhook events.
 */
export interface ReleaseWebhookPayload {
	/**
	 * Raw webhook event type (`'POST release'`).
	 */
	event: 'POST release';

	/**
	 * Discord bot snowflake ID for which the release was published.
	 */
	botId: string;

	/**
	 * Semantic version or release tag string.
	 */
	version: string;

	/**
	 * Optional release title.
	 */
	title?: string | null;

	/**
	 * Optional release notes / changelog markdown.
	 */
	changelog?: string | null;

	/**
	 * ISO-8601 timestamp when the release was published.
	 */
	timestamp: string;

	/**
	 * Raw JSON body received from the webhook request.
	 */
	raw: Record<string, any>;
}

/**
 * Payload emitted for `'stat'` (`POST stat`, `PATCH stat`, `DELETE stat`) webhook events.
 */
export interface StatWebhookPayload {
	/**
	 * Raw webhook event type.
	 */
	event: 'POST stat' | 'PATCH stat' | 'DELETE stat';

	/**
	 * Normalized telemetry stat lifecycle action.
	 */
	action: 'created' | 'updated' | 'deleted';

	/**
	 * Discord bot snowflake ID to which the stats belong.
	 */
	botId: string;

	/**
	 * Optional stat entry identifier.
	 */
	statId?: string | null;

	/**
	 * Reported guild/server count, if included in the payload.
	 */
	guildCount?: number | null;

	/**
	 * Reported shard count, if included in the payload.
	 */
	shardCount?: number | null;

	/**
	 * Reported user count, if included in the payload.
	 */
	userCount?: number | null;

	/**
	 * Reported vote count, if included in the payload.
	 */
	voteCount?: number | null;

	/**
	 * ISO-8601 timestamp of the stat event.
	 */
	timestamp: string;

	/**
	 * Raw JSON body received from the webhook request.
	 */
	raw: Record<string, any>;
}

/**
 * Payload emitted for `'test'` (`TEST ping`) webhook verification events.
 */
export interface TestWebhookPayload {
	/**
	 * Raw webhook event type (`'TEST ping'`).
	 */
	event: 'TEST ping';

	/**
	 * Optional Discord bot snowflake ID associated with the test ping.
	 */
	botId?: string | null;

	/**
	 * ISO-8601 timestamp when the test ping was received.
	 */
	timestamp: string;

	/**
	 * Raw JSON body received from the webhook request.
	 */
	raw: Record<string, any>;
}

/**
 * Union of all structured webhook payloads emitted by {@link HooksClient} and {@link XernerxHooks}.
 */
export type WebhookEventPayload = VoteWebhookPayload | ReviewWebhookPayload | TipWebhookPayload | ReleaseWebhookPayload | StatWebhookPayload | TestWebhookPayload;

/**
 * Event listener signature map for {@link HooksClient} and {@link XernerxHooks}.
 */
export interface HooksEvents {
	/**
	 * Emitted when a user votes for the bot (`POST vote`).
	 */
	vote: [payload: VoteWebhookPayload, user?: any];

	/**
	 * Emitted when a user creates, updates, deletes, or votes on a bot review.
	 */
	review: [payload: ReviewWebhookPayload, user?: any];

	/**
	 * Emitted when a user tips credits to the bot (`POST tip`).
	 */
	tip: [payload: TipWebhookPayload, user?: any];

	/**
	 * Emitted when a new bot release is published (`POST release`).
	 */
	release: [payload: ReleaseWebhookPayload];

	/**
	 * Emitted when bot telemetry statistics are created, updated, or deleted.
	 */
	stat: [payload: StatWebhookPayload];

	/**
	 * Emitted when a webhook verification ping (`TEST ping`) is received.
	 */
	test: [payload: TestWebhookPayload];

	/**
	 * Emitted for every verified webhook payload regardless of event type.
	 */
	webhook: [payload: WebhookEventPayload, user?: any];
}
