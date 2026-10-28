<!-- @format -->

![Xernerx Banner](https://xernerx.com/banner.png)

# @xernerx/hooks

Xernerx Hooks is the official webhook receiver and user engagement cache (`voted`, `reviewed`, `tipped`) for Discord bots on the [Xernerx Suite API](https://docs.xernerx.com/api/v1). Full API documentation is available on the [`@xernerx/hooks` Package Reference](https://docs.xernerx.com/packages/@xernerx/hooks).

## Features

- **HMAC-SHA256 & Secret Verification**: Constant-time verification (`crypto.timingSafeEqual`) of `X-Xernerx-Signature: sha256=<hmac>` and `X-Xernerx-Secret`.
- **Zero-Database Engagement Cache + REST Fallback**: Caches `voted` (with automatic 12-hour expiry tracking), `reviewed`, and `tipped` states in memory as webhooks arrive, and transparently falls back to `GET /v1/bots/:botId/users/:userId` on cache misses.
- **Native `@xernerx/framework` Extension**: Registers `this.hooks` on your `XernerxClient` so `EventBuilder` supports `emitter: 'hooks'` and enriches `interaction.user` / `message.user` (`XernerxUser`) with `voted`, `reviewed`, and `tipped`.
- **Standalone or Express Middleware**: Can spin up its own HTTP server or mount onto an existing Express application.

## Install

```bash
pnpm add @xernerx/hooks
```

## Setup

Extend `XernerxClient` from [`@xernerx/framework`](https://docs.xernerx.com/packages/@xernerx/framework) and load [`XernerxHooks`](https://docs.xernerx.com/packages/@xernerx/hooks#class-XernerxHooks) via `this.modules.extensionHandler.loadExtensions(...)`:

```ts
import { XernerxClient } from '@xernerx/framework';
import { XernerxHooks } from '@xernerx/hooks';

export class Client extends XernerxClient {
	constructor() {
		super({
			intents: ['Guilds', 'GuildMessages'],
			token: process.env.DISCORD_BOT_TOKEN!,
		});

		this.modules.extensionHandler.loadExtensions(
			new XernerxHooks(this, {
				secret: process.env.XERNERX_WEBHOOK_SECRET!, // whsec_... from Xernerx Developer Portal
				token: process.env.XERNERX_API_TOKEN, // Optional API token for REST fallback
				port: 3080,
				path: '/xernerx/hooks',
			})
		);

		this.connect();
	}
}

new Client();
```

---

## Handling Webhook Events

Because [`XernerxHooks`](https://docs.xernerx.com/packages/@xernerx/hooks#class-XernerxHooks) attaches itself as `this.client.hooks`, you can listen to `'vote'`, `'review'`, `'tip'`, `'release'`, `'stat'`, `'test'`, or `'webhook'` directly using `EventBuilder` with `emitter: 'hooks'`:

```ts
import { EventBuilder, XernerxUser } from '@xernerx/framework';
import type { VoteWebhookPayload } from '@xernerx/hooks';
import { Terminal } from '@xernerx/terminal';

export default class VoteEvent extends EventBuilder {
	private readonly console = new Terminal({ scope: 'XH' });

	constructor() {
		super('vote', {
			name: 'vote',
			emitter: 'hooks',
			once: false,
		});
	}

	override async run(payload: VoteWebhookPayload, user?: XernerxUser) {
		this.console.info(`User ${user?.tag ?? payload.userId} voted! Next vote at: ${payload.nextVoteAt}`);
	}
}
```

---

## User Engagement Cache

When `@xernerx/hooks` is loaded alongside [`@xernerx/framework`](https://docs.xernerx.com/packages/@xernerx/framework), `interaction.user` and `message.user` (`XernerxUser`) expose cached engagement properties that resolve from memory first and fall back to the Xernerx REST API only when uncached:

```ts
import { SlashCommandBuilder } from '@xernerx/framework';
import { Terminal } from '@xernerx/terminal';
import type { ChatInputCommandInteraction } from 'discord.js';

export default class RewardCommand extends SlashCommandBuilder {
	private readonly console = new Terminal({ scope: 'XH' });

	constructor() {
		super('reward', {
			name: 'reward',
			description: 'Claim your voter and supporter rewards.',
		});
	}

	override async exec(interaction: ChatInputCommandInteraction) {
		if (!interaction.user.voted) {
			return interaction.reply({ content: 'Please vote for the bot on Xernerx first!', ephemeral: true });
		}

		if (interaction.user.reviewed) {
			this.console.info(`User reviewed the bot with rating: ${(interaction.user as any).rating}/5`);
		}

		if (!interaction.user.tipped) {
			this.console.info('User has not tipped yet (tipped === 0).');
		} else {
			this.console.info(`User has tipped ${interaction.user.tipped} credits!`);
		}

		const engagement = await (this.client as any).hooks.getUserEngagement(interaction.user.id);
		const hasVoted = await (this.client as any).hooks.hasVoted(interaction.user.id);
		const hasReviewed = await (this.client as any).hooks.hasReviewed(interaction.user.id);
		const tippedCredits = await (this.client as any).hooks.getTipped(interaction.user.id);

		this.console.info(`Engagement verified: voted=${hasVoted}, reviewed=${hasReviewed}, tipped=${tippedCredits}, updatedAt=${engagement.updatedAt}`);
	}
}
```

---

## Standalone Usage (`HooksClient`)

`@xernerx/hooks` works standalone without `@xernerx/framework` or `discord.js` by extending [`HooksClient`](https://docs.xernerx.com/packages/@xernerx/hooks#class-HooksClient):

```ts
import { HooksClient } from '@xernerx/hooks';
import { Terminal } from '@xernerx/terminal';

export class Hooks extends HooksClient {
	private readonly console = new Terminal({ scope: 'XH' });

	constructor() {
		super({
			botId: 'YOUR_BOT_ID',
			secret: process.env.XERNERX_WEBHOOK_SECRET!,
			token: process.env.XERNERX_API_TOKEN,
			port: 3080,
			path: '/xernerx/hooks',
		});

		this.on('vote', (payload) => {
			this.console.info(`[VOTE] ${payload.userId} voted at ${payload.votedAt}`);
		});

		this.on('review', (payload) => {
			this.console.info(`[REVIEW] ${payload.userId} ${payload.action} review (${payload.rating}/5)`);
		});

		this.on('tip', (payload) => {
			this.console.info(`[TIP] ${payload.userId} tipped ${payload.amount} credits (total: ${payload.totalTipped})`);
		});

		this.on('release', (payload) => {
			this.console.info(`[RELEASE] New release ${payload.version}: ${payload.title}`);
		});

		this.on('stat', (payload) => {
			this.console.info(`[STAT] Stats ${payload.action}: ${payload.guildCount} guilds`);
		});

		this.on('test', (payload) => {
			this.console.info(`[TEST] Webhook ping verified at ${payload.timestamp}`);
		});
	}
}

new Hooks();
```

---

## Mounting onto Express

Pass an Express application via the `app` option in `super(...)` (or mount `this.createRouter()`):

```ts
import express from 'express';
import { HooksClient } from '@xernerx/hooks';
import { Terminal } from '@xernerx/terminal';

export class ExpressHooks extends HooksClient {
	private readonly console = new Terminal({ scope: 'XH' });

	constructor() {
		const app = express();

		super({
			botId: 'YOUR_BOT_ID',
			secret: process.env.XERNERX_WEBHOOK_SECRET!,
			path: '/xernerx/hooks',
			app,
		});

		app.listen(8080, () => {
			this.console.info(`Mounted Xernerx webhooks onto Express on port 8080 (${this.path})`);
		});
	}
}

new ExpressHooks();
```

---

## Configuration Options (`HooksClientOptions` / `XernerxHooksOptions`)

| Option       | Type      | Default                   | Required | Description                                                                             |
| ------------ | --------- | ------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `secret`     | `string`  | —                         | **Yes**  | Webhook signing secret (`whsec_...`) from the Xernerx Developer Portal.                 |
| `botId`      | `string`  | `client.user.id` or `""`  | No       | Discord bot snowflake ID (auto-detected when using `XernerxHooks`).                     |
| `token`      | `string`  | `""`                      | No       | Xernerx Suite API bearer token for REST fallback requests.                              |
| `port`       | `number`  | `3080`                    | No       | TCP port for the standalone Express server.                                             |
| `host`       | `string`  | `undefined`               | No       | Hostname/interface to bind the standalone server to.                                    |
| `path`       | `string`  | `'/xernerx/hooks'`        | No       | HTTP route path for receiving webhook POST requests.                                    |
| `app`        | `Express` | `undefined`               | No       | Existing Express app to mount the webhook router onto instead of starting a new server. |
| `autoStart`  | `boolean` | `true`                    | No       | Whether to automatically start the HTTP server when `app` is not provided.              |
| `cacheTtlMs` | `number`  | `900000` (15m)            | No       | Time-to-live in milliseconds for cached engagement states before REST re-validation.    |
| `url`        | `string`  | `https://api.xernerx.com` | No       | Custom base URL for the Xernerx Suite API.                                              |
| `dev`        | `boolean` | `false`                   | No       | Use local development API URL (`http://localhost:4001`).                                |

---

## Methods

| Method                                              | Return Type                              | Description                                                                                            |
| --------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `getUserEngagement(userId, botId?, force?)`         | `Promise<UserEngagementState>`           | Returns cached engagement state or fetches from `GET /v1/bots/:botId/users/:userId` on cache miss.     |
| `hasVoted(userId, botId?)`                          | `Promise<boolean>`                       | Returns `true` if the user has an active vote within the 12-hour window.                               |
| `hasReviewed(userId, botId?)`                       | `Promise<boolean>`                       | Returns `true` if the user has an active review on the bot.                                            |
| `getTipped(userId, botId?)`                         | `Promise<number>`                        | Returns `0` if the user has not tipped, or the positive credit amount (`> 0`) if tipped.               |
| `verifySignature(rawBody, signatureHdr, secretHdr)` | `boolean`                                | Verifies `X-Xernerx-Signature` (`sha256=<hmac>`) or `X-Xernerx-Secret` using `crypto.timingSafeEqual`. |
| `handleWebhook(rawEvent, body)`                     | `Promise<{ status: number; body: any }>` | Processes a verified webhook event, updates `this.cache`, and emits typed events.                      |
| `createRouter()`                                    | `Router`                                 | Creates an Express `Router` mounting `express.raw` and the webhook handler at `this.path`.             |
| `createMiddleware()`                                | `RequestHandler`                         | Creates the Express request handler middleware for webhook verification and dispatch.                  |
| `start(port?, host?)`                               | `Promise<Server>`                        | Starts the standalone HTTP server.                                                                     |
| `stop()`                                            | `Promise<void>`                          | Gracefully closes the standalone HTTP server.                                                          |

---

## Webhook Events

| Emitted Event | `X-Xernerx-Event` Header                                              | Payload Type            | Description                                                     |
| ------------- | --------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------- |
| `'vote'`      | `'POST vote'`                                                         | `VoteWebhookPayload`    | User voted for the bot (sets `voted = true` for 12 hours).      |
| `'review'`    | `'POST review' \| 'PATCH review' \| 'DELETE review' \| 'VOTE review'` | `ReviewWebhookPayload`  | User created, updated, deleted, or voted on a bot review.       |
| `'tip'`       | `'POST tip'`                                                          | `TipWebhookPayload`     | User tipped credits to the bot (updates `tipped` credit total). |
| `'release'`   | `'POST release'`                                                      | `ReleaseWebhookPayload` | New bot release published on Xernerx.                           |
| `'stat'`      | `'POST stat' \| 'PATCH stat' \| 'DELETE stat'`                        | `StatWebhookPayload`    | Bot telemetry stats created, updated, or deleted.               |
| `'test'`      | `'TEST ping'`                                                         | `TestWebhookPayload`    | Webhook verification ping from the Xernerx Developer Portal.    |
| `'webhook'`   | _Any event_                                                           | `WebhookEventPayload`   | Catch-all event emitted for every verified webhook payload.     |

---

## Documentation & API Reference

- [`@xernerx/hooks` Package Reference](https://docs.xernerx.com/packages/@xernerx/hooks)
- **Classes**:
  - [`XernerxHooks`](https://docs.xernerx.com/packages/@xernerx/hooks#class-XernerxHooks)
  - [`HooksClient`](https://docs.xernerx.com/packages/@xernerx/hooks#class-HooksClient)
  - [`BaseClient`](https://docs.xernerx.com/packages/@xernerx/hooks#class-BaseClient)
- **Interfaces**:
  - [`XernerxHooksOptions`](https://docs.xernerx.com/packages/@xernerx/hooks#interface-XernerxHooksOptions)
  - [`HooksClientOptions`](https://docs.xernerx.com/packages/@xernerx/hooks#interface-HooksClientOptions)
  - [`BaseClientOptions`](https://docs.xernerx.com/packages/@xernerx/hooks#interface-BaseClientOptions)
  - [`UserEngagementState`](https://docs.xernerx.com/packages/@xernerx/hooks#interface-UserEngagementState)
  - [`VoteWebhookPayload`](https://docs.xernerx.com/packages/@xernerx/hooks#interface-VoteWebhookPayload)
  - [`ReviewWebhookPayload`](https://docs.xernerx.com/packages/@xernerx/hooks#interface-ReviewWebhookPayload)
  - [`TipWebhookPayload`](https://docs.xernerx.com/packages/@xernerx/hooks#interface-TipWebhookPayload)
  - [`ReleaseWebhookPayload`](https://docs.xernerx.com/packages/@xernerx/hooks#interface-ReleaseWebhookPayload)
  - [`StatWebhookPayload`](https://docs.xernerx.com/packages/@xernerx/hooks#interface-StatWebhookPayload)
  - [`TestWebhookPayload`](https://docs.xernerx.com/packages/@xernerx/hooks#interface-TestWebhookPayload)
  - [`RawWebhookEnvelope`](https://docs.xernerx.com/packages/@xernerx/hooks#interface-RawWebhookEnvelope)
  - [`HooksEvents`](https://docs.xernerx.com/packages/@xernerx/hooks#interface-HooksEvents)
- **Ecosystem & REST API Docs**:
  - [Xernerx Documentation Home](https://docs.xernerx.com)
  - [All Xernerx Packages](https://docs.xernerx.com/packages)
  - [`@xernerx/framework` Documentation](https://docs.xernerx.com/packages/@xernerx/framework)
  - [`@xernerx/terminal` Documentation](https://docs.xernerx.com/packages/@xernerx/terminal)
  - [REST API v1 Overview & Authentication](https://docs.xernerx.com/api/v1)
  - [Developer Portal — Webhooks Configuration](https://portal.xernerx.com)
  - [Release Changelog](https://info.xernerx.com/changelog#@xernerx/hooks)

---

## Support & Links

- [Discord Support Server](https://xernerx.com/discord)
- [Xernerx Documentation](https://docs.xernerx.com)
- [Xernerx Developer Portal](https://portal.xernerx.com)
