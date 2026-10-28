/** @format */

import crypto from 'node:crypto';
import type { Server } from 'node:http';
import express, { type Express, type Request, type Response, type RequestHandler, type Router } from 'express';
import { ExtensionBuilder } from '@xernerx/extension-builder';
import { terminal } from '@xernerx/terminal';

import { BaseClient, type BaseClientOptions } from './BaseClient.js';
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
} from '../types/webhooks.js';

const t = terminal.child({ scope: 'XH' });

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Configuration options for {@link HooksClient}.
 */
export interface HooksClientOptions extends BaseClientOptions {
	/**
	 * Discord bot snowflake ID used for engagement cache keys and REST fallback lookups.
	 */
	botId?: string;

	/**
	 * Webhook signing secret (`whsec_...`) from the Xernerx Developer Portal used to verify
	 * incoming `X-Xernerx-Signature` (HMAC-SHA256) and `X-Xernerx-Secret` headers.
	 */
	secret: string;

	/**
	 * Optional Xernerx Suite API bearer token used when fetching uncached user engagement states via REST.
	 */
	token?: string;

	/**
	 * TCP port for the standalone Express HTTP server (defaults to `3080`).
	 */
	port?: number;

	/**
	 * Optional hostname/interface to bind the standalone HTTP server to (e.g. `'0.0.0.0'`).
	 */
	host?: string;

	/**
	 * Route path on which the webhook receiver listens (defaults to `'/xernerx/hooks'`).
	 */
	path?: string;

	/**
	 * Optional existing Express application instance to mount the webhook router onto instead of starting a new HTTP server.
	 */
	app?: Express;

	/**
	 * Whether to automatically start the standalone HTTP server on construction (defaults to `true` when `port` is provided and `app` is omitted).
	 */
	autoStart?: boolean;

	/**
	 * Time-to-live in milliseconds for cached {@link UserEngagementState} entries before falling back to REST (defaults to `900000` / 15 minutes).
	 */
	cacheTtlMs?: number;
}

/**
 * Standalone Xernerx webhook receiver and in-memory user engagement cache (`voted`, `reviewed`, `tipped`)
 * with automatic `api.xernerx.com` REST fallback.
 *
 * @example
 * ```ts
 * import { HooksClient } from '@xernerx/hooks';
 * import { Terminal } from '@xernerx/terminal';
 *
 * export class Hooks extends HooksClient {
 * 	private readonly console = new Terminal({ scope: 'XH' });
 *
 * 	constructor() {
 * 		super({
 * 			botId: 'YOUR_BOT_ID',
 * 			secret: process.env.XERNERX_WEBHOOK_SECRET!,
 * 			token: process.env.XERNERX_API_TOKEN,
 * 			port: 3080,
 * 		});
 *
 * 		this.on('vote', (payload) => {
 * 			this.console.info(`${payload.userId} voted!`);
 * 		});
 * 	}
 * }
 *
 * new Hooks();
 * ```
 */
export class HooksClient extends ExtensionBuilder<any, HooksClientOptions> {
	/**
	 * Discord bot snowflake ID associated with this client.
	 */
	public botId: string;

	/**
	 * Webhook signing secret (`whsec_...`) used to verify incoming webhook requests.
	 */
	public readonly secret: string;

	/**
	 * Xernerx Suite API bearer token used for REST fallback requests.
	 */
	public readonly token: string;

	/**
	 * Resolved base URL for the Xernerx Suite API.
	 */
	public readonly url: string;

	/**
	 * Configured TCP port for the standalone Express server.
	 */
	public readonly port: number;

	/**
	 * Optional hostname/interface to bind the standalone HTTP server to.
	 */
	public readonly host?: string;

	/**
	 * Normalized route path for the webhook endpoint (always starts with `'/'`).
	 */
	public readonly path: string;

	/**
	 * Time-to-live in milliseconds for cached engagement entries before a REST re-fetch is performed.
	 */
	public readonly cacheTtlMs: number;

	/**
	 * In-memory engagement cache mapping `${botId}:${userId}` and `${userId}` to {@link UserEngagementState}.
	 */
	public readonly cache = new Map<string, UserEngagementState>();

	/**
	 * Underlying Express application instance, if created or mounted.
	 */
	protected app: Express | null = null;

	/**
	 * Active Node.js HTTP server instance when running in standalone mode.
	 */
	protected server: Server | null = null;

	/**
	 * Creates a new {@link HooksClient} instance.
	 *
	 * @param options - Webhook verification, Express server, and engagement cache options.
	 */
	constructor(options: HooksClientOptions) {
		super('XernerxHooks', options);

		const base = new BaseClient(options.token || '', { url: options.url, dev: options.dev });
		this.token = base.token;
		this.url = base.url;
		this.botId = options.botId || '';
		this.secret = options.secret || '';
		this.port = options.port ?? 3080;
		this.host = options.host;
		this.path = options.path ? (options.path.startsWith('/') ? options.path : `/${options.path}`) : '/xernerx/hooks';
		this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

		if (options.app) {
			this.app = options.app;
			this.app.use(this.createRouter());
		} else {
			const shouldAutoStart = options.autoStart ?? options.port !== undefined;
			if (shouldAutoStart) {
				void this.start(this.port, this.host).catch((err) => {
					t.error((err as Error)?.message || String(err));
				});
			}
		}
	}

	/**
	 * Verifies an incoming webhook request's `X-Xernerx-Signature` (HMAC-SHA256) or `X-Xernerx-Secret` header
	 * using constant-time comparison (`crypto.timingSafeEqual`).
	 *
	 * @param rawBody - Raw request body buffer or UTF-8 string.
	 * @param signatureHeader - Value of the `X-Xernerx-Signature` header (`sha256=<hex>`).
	 * @param secretHeader - Value of the `X-Xernerx-Secret` header.
	 * @returns `true` if either the HMAC signature or shared secret header is valid; otherwise `false`.
	 */
	public verifySignature(rawBody: Buffer | string, signatureHeader?: string | null, secretHeader?: string | null): boolean {
		if (!this.secret) return false;

		const payloadBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');

		if (signatureHeader && typeof signatureHeader === 'string') {
			const normalizedSig = signatureHeader.trim().replace(/^sha256=/i, '');
			const expectedSig = crypto.createHmac('sha256', this.secret).update(payloadBuffer).digest('hex');

			const providedBuf = Buffer.from(normalizedSig, 'utf8');
			const expectedBuf = Buffer.from(expectedSig, 'utf8');

			if (providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf)) {
				return true;
			}
		}

		if (secretHeader && typeof secretHeader === 'string') {
			const providedSecretBuf = Buffer.from(secretHeader.trim(), 'utf8');
			const expectedSecretBuf = Buffer.from(this.secret, 'utf8');

			if (providedSecretBuf.length === expectedSecretBuf.length && crypto.timingSafeEqual(providedSecretBuf, expectedSecretBuf)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Creates an Express request handler middleware that validates the webhook signature/secret
	 * and dispatches the parsed payload to {@link handleWebhook}.
	 *
	 * @returns An Express `RequestHandler` function.
	 */
	public createMiddleware(): RequestHandler {
		return async (req: Request, res: Response) => {
			try {
				let rawBody: Buffer;
				let parsedBody: Record<string, any> = {};

				if (Buffer.isBuffer(req.body)) {
					rawBody = req.body;
					const text = rawBody.toString('utf8').trim();
					parsedBody = text ? (JSON.parse(text) as Record<string, any>) : {};
				} else if (Buffer.isBuffer((req as any).rawBody)) {
					rawBody = (req as any).rawBody;
					parsedBody = req.body && typeof req.body === 'object' ? (req.body as Record<string, any>) : {};
				} else if (typeof req.body === 'string') {
					rawBody = Buffer.from(req.body, 'utf8');
					parsedBody = req.body.trim() ? (JSON.parse(req.body) as Record<string, any>) : {};
				} else if (req.body && typeof req.body === 'object') {
					rawBody = Buffer.from(JSON.stringify(req.body), 'utf8');
					parsedBody = req.body as Record<string, any>;
				} else {
					rawBody = Buffer.alloc(0);
					parsedBody = {};
				}

				const signatureHeader = req.header('x-xernerx-signature') || req.header('X-Xernerx-Signature');
				const secretHeader = req.header('x-xernerx-secret') || req.header('X-Xernerx-Secret');

				if (!this.verifySignature(rawBody, signatureHeader, secretHeader)) {
					res.status(401).json({ error: 'Invalid webhook signature or secret' });
					return;
				}

				const rawEvent = req.header('x-xernerx-event') || req.header('X-Xernerx-Event') || parsedBody.event;
				const result = await this.handleWebhook(rawEvent, parsedBody);
				res.status(result.status).json(result.body);
			} catch (error) {
				t.error((error as Error)?.message || String(error));
				res.status(400).json({ error: 'Malformed webhook payload' });
			}
		};
	}

	/**
	 * Creates an Express `Router` mounting the raw body parser (`express.raw`) and webhook handler at {@link path}.
	 *
	 * @returns Configured Express `Router`.
	 */
	public createRouter(): Router {
		const router = express.Router();
		router.post(this.path, express.raw({ type: '*/*', limit: '1mb' }), this.createMiddleware());
		return router;
	}

	/**
	 * Starts the standalone Express HTTP server listening for Xernerx webhooks.
	 *
	 * @param port - TCP port to listen on (defaults to `this.port`).
	 * @param host - Optional hostname/interface to bind to (defaults to `this.host`).
	 * @returns A promise that resolves to the active Node.js HTTP `Server`.
	 */
	public async start(port = this.port, host = this.host): Promise<Server> {
		if (this.server) {
			return this.server;
		}

		const app = this.app ?? express();
		if (!this.app) {
			this.app = app;
			app.use(this.createRouter());
		}

		return await new Promise<Server>((resolve, reject) => {
			const onError = (err: Error) => {
				reject(err);
			};

			const server = host
				? app.listen(port, host, () => {
						server.removeListener('error', onError);
						this.server = server;
						t.info(`Listening for Xernerx webhooks on http://${host}:${port}${this.path}`);
						resolve(server);
					})
				: app.listen(port, () => {
						server.removeListener('error', onError);
						this.server = server;
						t.info(`Listening for Xernerx webhooks on port ${port} (${this.path})`);
						resolve(server);
					});

			server.once('error', onError);
		});
	}

	/**
	 * Stops the standalone HTTP server if currently running.
	 *
	 * @returns A promise that resolves once the server has closed.
	 */
	public async stop(): Promise<void> {
		if (!this.server) return;
		const activeServer = this.server;
		this.server = null;

		await new Promise<void>((resolve, reject) => {
			activeServer.close((err) => {
				if (err) reject(err);
				else resolve();
			});
		});
	}

	/**
	 * Processes a verified webhook event, updates the in-memory engagement cache, and emits typed events.
	 *
	 * @param rawEvent - Raw event string from the `X-Xernerx-Event` header or request body.
	 * @param body - Parsed JSON webhook payload body.
	 * @returns HTTP status code and JSON response body to return to the webhook sender.
	 */
	public async handleWebhook(rawEvent: string | undefined, body: Record<string, any>): Promise<{ status: number; body: Record<string, any> }> {
		const resolvedEvent = this.resolveEventName(rawEvent, body);
		const data = body?.data && typeof body.data === 'object' ? (body.data as Record<string, any>) : body;
		const embedFallback = this.extractEmbedFallback(body);
		const botId = String(data.botId || data.bot?.id || body.botId || embedFallback.botId || this.botId || '');
		if (botId && !this.botId) {
			this.botId = botId;
		}

		if (resolvedEvent === 'TEST ping') {
			const payload: TestWebhookPayload = {
				event: 'TEST ping',
				botId: botId || null,
				timestamp: String(data.timestamp || body.timestamp || new Date().toISOString()),
				raw: body,
			};

			t.info(`Received TEST ping webhook${botId ? ` for bot ${botId}` : ''}.`);
			await this.onWebhookEvent('test', payload);
			this.emit('test', payload);
			this.emit('webhook', payload);
			return { status: 200, body: { ok: true, event: 'TEST ping' } };
		}

		if (resolvedEvent === 'POST vote') {
			const userId = String(data.userId || data.user?.id || body.userId || embedFallback.userId || '');
			const votedAt = String(data.votedAt || data.lastVotedAt || data.timestamp || body.timestamp || new Date().toISOString());
			const nextVoteAt = String(data.nextVoteAt || new Date(Date.parse(votedAt) + TWELVE_HOURS_MS).toISOString());
			const existing = this.getCachedState(userId, botId);

			const engagement: UserEngagementState = {
				userId,
				botId,
				voted: true,
				lastVotedAt: votedAt,
				nextVoteAt,
				reviewed: existing?.reviewed ?? false,
				rating: existing?.rating ?? null,
				tipped: existing?.tipped ?? 0,
				updatedAt: Date.now(),
			};

			if (userId) {
				this.setCachedState(engagement);
			}

			const payload: VoteWebhookPayload = {
				event: 'POST vote',
				botId,
				userId,
				voted: true,
				votedAt,
				nextVoteAt,
				totalVotes: typeof data.totalVotes === 'number' ? data.totalVotes : undefined,
				streak: typeof data.streak === 'number' ? data.streak : undefined,
				engagement,
				raw: body,
			};

			await this.onWebhookEvent('vote', payload);
			this.emit('vote', payload, payload.user);
			this.emit('webhook', payload, payload.user);
			return { status: 200, body: { ok: true, event: resolvedEvent } };
		}

		if (resolvedEvent === 'POST review' || resolvedEvent === 'PATCH review' || resolvedEvent === 'DELETE review' || resolvedEvent === 'VOTE review') {
			const userId = String(data.userId || data.user?.id || body.userId || embedFallback.userId || '');
			const existing = this.getCachedState(userId, botId);
			const isDeleted = resolvedEvent === 'DELETE review';
			const parsedRating = isDeleted ? null : typeof data.rating === 'number' ? data.rating : typeof embedFallback.rating === 'number' ? embedFallback.rating : (existing?.rating ?? null);

			const engagement: UserEngagementState = {
				userId,
				botId,
				voted: this.isVoteActive(existing),
				lastVotedAt: existing?.lastVotedAt ?? null,
				nextVoteAt: existing?.nextVoteAt ?? null,
				reviewed: !isDeleted,
				rating: parsedRating,
				tipped: existing?.tipped ?? 0,
				updatedAt: Date.now(),
			};

			if (userId) {
				this.setCachedState(engagement);
			}

			const actionMap: Record<'POST review' | 'PATCH review' | 'DELETE review' | 'VOTE review', ReviewWebhookPayload['action']> = {
				'POST review': 'created',
				'PATCH review': 'updated',
				'DELETE review': 'deleted',
				'VOTE review': 'voted',
			};

			const payload: ReviewWebhookPayload = {
				event: resolvedEvent,
				action: actionMap[resolvedEvent],
				botId,
				userId,
				reviewId: data.reviewId || data._id || undefined,
				rating: parsedRating,
				content: data.content ?? data.comment ?? embedFallback.content ?? null,
				reviewed: !isDeleted,
				timestamp: String(data.timestamp || body.timestamp || new Date().toISOString()),
				engagement,
				raw: body,
			};

			await this.onWebhookEvent('review', payload);
			this.emit('review', payload, payload.user);
			this.emit('webhook', payload, payload.user);
			return { status: 200, body: { ok: true, event: resolvedEvent } };
		}

		if (resolvedEvent === 'POST tip') {
			const userId = String(data.userId || data.user?.id || body.userId || embedFallback.userId || '');
			const existing = this.getCachedState(userId, botId);
			const amount = Number(data.amount ?? data.tipped ?? embedFallback.amount ?? 0) || 0;
			const totalTipped = typeof data.totalTipped === 'number' ? data.totalTipped : (existing?.tipped || 0) + amount;

			const engagement: UserEngagementState = {
				userId,
				botId,
				voted: this.isVoteActive(existing),
				lastVotedAt: existing?.lastVotedAt ?? null,
				nextVoteAt: existing?.nextVoteAt ?? null,
				reviewed: existing?.reviewed ?? false,
				rating: existing?.rating ?? null,
				tipped: totalTipped,
				updatedAt: Date.now(),
			};

			if (userId) {
				this.setCachedState(engagement);
			}

			const payload: TipWebhookPayload = {
				event: 'POST tip',
				botId,
				userId,
				amount,
				totalTipped,
				tipped: totalTipped,
				message: data.message ?? embedFallback.content ?? null,
				timestamp: String(data.timestamp || body.timestamp || new Date().toISOString()),
				engagement,
				raw: body,
			};

			await this.onWebhookEvent('tip', payload);
			this.emit('tip', payload, payload.user);
			this.emit('webhook', payload, payload.user);
			return { status: 200, body: { ok: true, event: resolvedEvent } };
		}

		if (resolvedEvent === 'POST release') {
			const payload: ReleaseWebhookPayload = {
				event: 'POST release',
				botId,
				version: String(data.version || data.tag || embedFallback.version || ''),
				title: data.title ?? embedFallback.title ?? null,
				changelog: data.changelog ?? data.description ?? embedFallback.content ?? null,
				timestamp: String(data.timestamp || body.timestamp || new Date().toISOString()),
				raw: body,
			};

			await this.onWebhookEvent('release', payload);
			this.emit('release', payload);
			this.emit('webhook', payload);
			return { status: 200, body: { ok: true, event: resolvedEvent } };
		}

		if (resolvedEvent === 'POST stat' || resolvedEvent === 'PATCH stat' || resolvedEvent === 'DELETE stat') {
			const actionMap: Record<'POST stat' | 'PATCH stat' | 'DELETE stat', StatWebhookPayload['action']> = {
				'POST stat': 'created',
				'PATCH stat': 'updated',
				'DELETE stat': 'deleted',
			};

			const payload: StatWebhookPayload = {
				event: resolvedEvent,
				action: actionMap[resolvedEvent],
				botId,
				statId: data.statId ?? data._id ?? null,
				guildCount: typeof (data.guildCount ?? data.serverCount) === 'number' ? Number(data.guildCount ?? data.serverCount) : null,
				shardCount: typeof data.shardCount === 'number' ? data.shardCount : null,
				userCount: typeof data.userCount === 'number' ? data.userCount : null,
				voteCount: typeof data.voteCount === 'number' ? data.voteCount : null,
				timestamp: String(data.timestamp || body.timestamp || new Date().toISOString()),
				raw: body,
			};

			await this.onWebhookEvent('stat', payload);
			this.emit('stat', payload);
			this.emit('webhook', payload);
			return { status: 200, body: { ok: true, event: resolvedEvent } };
		}

		return { status: 200, body: { ok: true, event: resolvedEvent || 'unknown' } };
	}

	/**
	 * Resolves a user's engagement state (`voted`, `reviewed`, `tipped`) from the in-memory cache first,
	 * falling back to `GET /v1/bots/:botId/users/:userId` on cache miss or TTL expiration.
	 *
	 * @param userId - Discord user snowflake ID to check.
	 * @param botId - Optional Discord bot snowflake ID (defaults to `this.botId`).
	 * @param force - When `true`, bypasses the cache TTL and forces a fresh REST lookup.
	 * @returns Resolved {@link UserEngagementState} for the user.
	 */
	public async getUserEngagement(userId: string, botId = this.botId, force = false): Promise<UserEngagementState> {
		const resolvedBotId = botId || this.botId || '';
		const cached = this.getCachedState(userId, resolvedBotId);

		if (cached) {
			if (cached.nextVoteAt && Date.now() >= Date.parse(cached.nextVoteAt)) {
				cached.voted = false;
			}

			if (!force && Date.now() - cached.updatedAt < this.cacheTtlMs) {
				return cached;
			}
		}

		if (!resolvedBotId) {
			return (
				cached ?? {
					userId,
					botId: '',
					voted: false,
					lastVotedAt: null,
					nextVoteAt: null,
					reviewed: false,
					rating: null,
					tipped: 0,
					updatedAt: Date.now(),
				}
			);
		}

		try {
			const headers: Record<string, string> = {};
			if (this.token) {
				headers.Authorization = `Bearer ${this.token}`;
			}

			const response = await fetch(`${this.url}/v1/bots/${encodeURIComponent(resolvedBotId)}/users/${encodeURIComponent(userId)}`, {
				method: 'GET',
				headers,
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const raw: any = await response.json().catch(() => null);
			const payload = raw?.data && typeof raw.data === 'object' ? raw.data : raw || {};

			const nextVoteAt: string | null = payload.nextVoteAt ?? cached?.nextVoteAt ?? null;
			const lastVotedAt: string | null = payload.lastVotedAt ?? payload.votedAt ?? cached?.lastVotedAt ?? null;
			const votedFromApi = typeof payload.voted === 'boolean' ? payload.voted : nextVoteAt ? Date.now() < Date.parse(nextVoteAt) : false;
			const voted = nextVoteAt && Date.now() >= Date.parse(nextVoteAt) ? false : votedFromApi;

			const rating: number | null = typeof payload.rating === 'number' ? payload.rating : typeof payload.review?.rating === 'number' ? payload.review.rating : (cached?.rating ?? null);

			const reviewed = typeof payload.reviewed === 'boolean' ? payload.reviewed : Boolean(payload.review != null || typeof rating === 'number' || cached?.reviewed);

			const tipped =
				typeof payload.tipped === 'number'
					? payload.tipped
					: typeof payload.totalTipped === 'number'
						? payload.totalTipped
						: typeof payload.tips === 'number'
							? payload.tips
							: payload.tipped === true
								? Math.max(1, cached?.tipped ?? 1)
								: (cached?.tipped ?? 0);

			const state: UserEngagementState = {
				userId,
				botId: resolvedBotId,
				voted,
				lastVotedAt,
				nextVoteAt,
				reviewed,
				rating,
				tipped,
				updatedAt: Date.now(),
			};

			this.setCachedState(state);
			return state;
		} catch {
			if (cached) {
				return cached;
			}

			const fallback: UserEngagementState = {
				userId,
				botId: resolvedBotId,
				voted: false,
				lastVotedAt: null,
				nextVoteAt: null,
				reviewed: false,
				rating: null,
				tipped: 0,
				updatedAt: Date.now(),
			};

			this.setCachedState(fallback);
			return fallback;
		}
	}

	/**
	 * Checks whether the specified user currently has an active vote for the bot.
	 *
	 * @param userId - Discord user snowflake ID to check.
	 * @param botId - Optional Discord bot snowflake ID (defaults to `this.botId`).
	 * @returns `true` if the user has voted within the last 12 hours; otherwise `false`.
	 */
	public async hasVoted(userId: string, botId = this.botId): Promise<boolean> {
		const state = await this.getUserEngagement(userId, botId);
		return state.voted;
	}

	/**
	 * Checks whether the specified user has left an active review for the bot.
	 *
	 * @param userId - Discord user snowflake ID to check.
	 * @param botId - Optional Discord bot snowflake ID (defaults to `this.botId`).
	 * @returns `true` if the user has an active review; otherwise `false`.
	 */
	public async hasReviewed(userId: string, botId = this.botId): Promise<boolean> {
		const state = await this.getUserEngagement(userId, botId);
		return state.reviewed;
	}

	/**
	 * Returns the cumulative credit amount tipped by the user (`0` if not tipped, `> 0` if tipped).
	 *
	 * @param userId - Discord user snowflake ID to check.
	 * @param botId - Optional Discord bot snowflake ID (defaults to `this.botId`).
	 * @returns Credit amount tipped by the user (`0` when not tipped).
	 */
	public async getTipped(userId: string, botId = this.botId): Promise<number> {
		const state = await this.getUserEngagement(userId, botId);
		return state.tipped;
	}

	/**
	 * Lifecycle hook invoked before a webhook event is emitted on this instance.
	 * Overridden by `XernerxHooks` to resolve and enrich the Discord `User` / `XernerxUser`.
	 *
	 * @param _eventName - Normalized webhook event name.
	 * @param _payload - Structured webhook event payload.
	 */
	protected async onWebhookEvent(_eventName: WebhookEventName, _payload: WebhookEventPayload): Promise<void> {
		// Overridden by XernerxHooks to enrich Discord User / XernerxUser
	}

	/**
	 * Retrieves a user's cached engagement state from {@link cache} by scoped (`${botId}:${userId}`) or unscoped (`${userId}`) key.
	 *
	 * @param userId - Discord user snowflake ID.
	 * @param botId - Optional Discord bot snowflake ID.
	 * @returns Cached {@link UserEngagementState} if present; otherwise `undefined`.
	 */
	protected getCachedState(userId: string, botId = this.botId): UserEngagementState | undefined {
		if (!userId) return undefined;
		if (botId) {
			const scoped = this.cache.get(`${botId}:${userId}`);
			if (scoped) return scoped;
		}
		return this.cache.get(userId);
	}

	/**
	 * Stores a user's engagement state in {@link cache} under both scoped (`${botId}:${userId}`) and unscoped (`${userId}`) keys.
	 *
	 * @param state - Engagement state to cache.
	 */
	protected setCachedState(state: UserEngagementState): void {
		if (!state.userId) return;
		if (state.botId) {
			this.cache.set(`${state.botId}:${state.userId}`, state);
		}
		this.cache.set(state.userId, state);
	}

	private isVoteActive(state?: UserEngagementState): boolean {
		if (!state || !state.voted) return false;
		if (state.nextVoteAt && Date.now() >= Date.parse(state.nextVoteAt)) {
			state.voted = false;
			return false;
		}
		return true;
	}

	private resolveEventName(rawHeader: string | undefined, body: Record<string, any>): RawWebhookEventName | string {
		if (rawHeader && typeof rawHeader === 'string') {
			return rawHeader.trim() as RawWebhookEventName;
		}

		if (typeof body?.event === 'string') {
			return body.event.trim() as RawWebhookEventName;
		}

		const embedTitle = String(body?.embeds?.[0]?.title || '').toLowerCase();
		if (embedTitle.includes('vote')) return 'POST vote';
		if (embedTitle.includes('review')) return 'POST review';
		if (embedTitle.includes('tip')) return 'POST tip';
		if (embedTitle.includes('release')) return 'POST release';
		if (embedTitle.includes('stat')) return 'POST stat';
		if (embedTitle.includes('test') || embedTitle.includes('ping')) return 'TEST ping';

		return 'TEST ping';
	}

	private extractEmbedFallback(body: Record<string, any>): {
		userId?: string;
		botId?: string;
		rating?: number;
		amount?: number;
		version?: string;
		title?: string;
		content?: string;
	} {
		const embed = body?.embeds?.[0];
		if (!embed || typeof embed !== 'object') return {};

		const fields: Array<{ name?: string; value?: string }> = Array.isArray(embed.fields) ? embed.fields : [];
		const textBlob = [embed.title, embed.description, ...fields.map((f) => `${f.name || ''}: ${f.value || ''}`)].filter(Boolean).join('\n');

		const mentionMatch = textBlob.match(/<@!?(\d{17,20})>/);
		const idMatch = textBlob.match(/\b(\d{17,20})\b/);
		const userId = mentionMatch?.[1] || idMatch?.[1];

		let rating: number | undefined;
		const ratingMatch = textBlob.match(/([1-5])\s*\/\s*5/);
		if (ratingMatch) {
			rating = Number(ratingMatch[1]);
		} else if (embed.description) {
			const stars = (String(embed.description).match(/⭐/g) || []).length;
			if (stars >= 1 && stars <= 5) rating = stars;
		}

		let amount: number | undefined;
		const amountMatch = textBlob.match(/(\d+(?:\.\d+)?)\s*(?:credits?|coins?)/i);
		if (amountMatch) {
			amount = Number(amountMatch[1]);
		}

		return {
			userId,
			rating,
			amount,
			title: typeof embed.title === 'string' ? embed.title : undefined,
			content: typeof embed.description === 'string' ? embed.description : undefined,
		};
	}
}

export type {
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
};
