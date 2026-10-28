/** @format */

import * as Framework from '@xernerx/framework';
import type { XernerxClient, XernerxShardClient } from '@xernerx/framework';
import { HooksClient, type HooksClientOptions } from './HooksClient.js';
import type { WebhookEventName, WebhookEventPayload } from '../types/webhooks.js';

/**
 * Configuration options for the {@link XernerxHooks} framework extension.
 */
export interface XernerxHooksOptions extends HooksClientOptions {}

/**
 * `@xernerx/framework` extension that mounts a Xernerx webhook receiver onto a `XernerxClient`,
 * registers `client.hooks` as an event emitter (`emitter: 'hooks'`), and enriches `XernerxUser`
 * with cached engagement state (`voted`, `reviewed`, `tipped`).
 *
 * @example
 * ```ts
 * import { XernerxClient } from '@xernerx/framework';
 * import { XernerxHooks } from '@xernerx/hooks';
 *
 * export class Client extends XernerxClient {
 * 	constructor() {
 * 		super({
 * 			intents: ['Guilds'],
 * 			token: process.env.DISCORD_BOT_TOKEN!,
 * 		});
 *
 * 		this.modules.extensionHandler.loadExtensions(
 * 			new XernerxHooks(this, {
 * 				secret: process.env.XERNERX_WEBHOOK_SECRET!,
 * 				token: process.env.XERNERX_API_TOKEN,
 * 				port: 3080,
 * 			})
 * 		);
 *
 * 		this.connect();
 * 	}
 * }
 *
 * new Client();
 * ```
 */
export class XernerxHooks extends HooksClient {
	/**
	 * Unique extension identifier recognized by `@xernerx/framework`'s `ExtensionHandler`.
	 */
	public readonly id = 'XernerxHooks';

	/**
	 * Extension filetype discriminator required by `@xernerx/framework`'s `ExtensionHandler`.
	 */
	public readonly filetype = 'XernerxExtension' as const;

	private _client!: XernerxClient | XernerxShardClient;
	private initialized = false;

	/**
	 * Creates a new {@link XernerxHooks} extension instance and binds it to the provided framework client.
	 *
	 * @param client - `XernerxClient` or `XernerxShardClient` instance.
	 * @param options - Webhook secret, API token, port/Express app, and cache configuration.
	 */
	constructor(client: XernerxClient | XernerxShardClient, options: XernerxHooksOptions) {
		super({
			...options,
			botId: options.botId || (client as XernerxClient)?.user?.id || '',
			autoStart: options.autoStart ?? !options.app,
		});

		if (client) {
			this.client = client;
		}
	}

	/**
	 * Attached `XernerxClient` or `XernerxShardClient` instance.
	 */
	public get client(): XernerxClient | XernerxShardClient {
		return this._client;
	}

	/**
	 * Attaches the `XernerxClient` or `XernerxShardClient` instance, registering `client.hooks`
	 * and `client.resolveUserEngagement`.
	 */
	public set client(value: XernerxClient | XernerxShardClient) {
		this._client = value;
		if (value) {
			(value as any).hooks = this;
			(value as any).userEngagementCache = this.cache;
			(value as any).resolveUserEngagement = (userId: string, force?: boolean) => this.getUserEngagement(userId, (value as XernerxClient)?.user?.id || this.botId, force);

			if (!this.initialized) {
				this.initialized = true;
				void this.main(value);
			}
		}
	}

	/**
	 * Initializes the extension on the target client, wiring `client.hooks`, `client.userEngagementCache`,
	 * `client.resolveUserEngagement`, and automatic `botId` resolution on `clientReady`.
	 *
	 * @param client - Target `XernerxClient` or `XernerxShardClient`.
	 */
	public async main(client: XernerxClient | XernerxShardClient = this._client): Promise<void> {
		if (!client) return;
		this._client = client;

		(client as any).hooks = this;
		(client as any).userEngagementCache = this.cache;
		(client as any).resolveUserEngagement = (userId: string, force?: boolean) => this.getUserEngagement(userId, (client as XernerxClient)?.user?.id || this.botId, force);

		if (!this.botId && (client as XernerxClient)?.user?.id) {
			this.botId = (client as XernerxClient).user!.id;
		}

		if ('on' in client && typeof (client as any).on === 'function') {
			(client as any).on('clientReady', (readyClient: any) => {
				if (!this.botId && readyClient?.user?.id) {
					this.botId = readyClient.user.id;
				}
			});
		}
	}

	/**
	 * Resolves and enriches the Discord `User` / `XernerxUser` with engagement properties (`voted`, `reviewed`, `tipped`)
	 * whenever a `'vote'`, `'review'`, or `'tip'` webhook arrives, and forwards the event onto `client`.
	 *
	 * @param eventName - Normalized webhook event name.
	 * @param payload - Structured webhook event payload.
	 */
	protected override async onWebhookEvent(eventName: WebhookEventName, payload: WebhookEventPayload): Promise<void> {
		const client = this._client as XernerxClient | undefined;
		if (!client) return;

		if (!this.botId && client.user?.id) {
			this.botId = client.user.id;
		}

		if (eventName === 'vote' || eventName === 'review' || eventName === 'tip') {
			const userPayload = payload as Extract<WebhookEventPayload, { userId: string }>;
			if (userPayload.userId && 'users' in client && client.users) {
				const rawUser = client.users.cache.get(userPayload.userId) || (await client.users.fetch(userPayload.userId).catch(() => null));

				if (rawUser) {
					let enrichedUser: any = rawUser;
					try {
						const XernerxUserClass = (Framework as any).XernerxUser;
						enrichedUser = XernerxUserClass && !(rawUser instanceof XernerxUserClass) ? new XernerxUserClass(client as any, rawUser) : rawUser;
					} catch {
						enrichedUser = rawUser;
					}

					enrichedUser.voted = userPayload.engagement.voted;
					enrichedUser.lastVotedAt = userPayload.engagement.lastVotedAt;
					enrichedUser.nextVoteAt = userPayload.engagement.nextVoteAt;
					enrichedUser.reviewed = userPayload.engagement.reviewed;
					enrichedUser.rating = userPayload.engagement.rating;
					enrichedUser.tipped = userPayload.engagement.tipped;
					enrichedUser.engagement = userPayload.engagement;

					userPayload.user = enrichedUser;
				}
			}
		}

		if ('emit' in client && typeof (client as any).emit === 'function') {
			const user = (payload as any).user;
			(client as any).emit(eventName, payload as any, user);
			(client as any).emit('webhook', payload as any, user);
		}
	}
}
