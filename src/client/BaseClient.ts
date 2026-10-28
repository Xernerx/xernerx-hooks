/** @format */

/**
 * Configuration options for {@link BaseClient}.
 */
export interface BaseClientOptions {
	/**
	 * Custom base URL for the Xernerx Suite API.
	 * Defaults to `https://api.xernerx.com` (or `https://api.canary.xernerx.com` when `ENVIRONMENT=CANARY`).
	 */
	url?: string;

	/**
	 * When `true`, targets the local development API server at `http://localhost:4001`.
	 */
	dev?: boolean;
}

/**
 * Base HTTP client that resolves the Xernerx Suite API base URL and authentication token.
 */
export class BaseClient {
	/**
	 * Bearer authentication token for the Xernerx Suite API.
	 */
	public readonly token: string;

	/**
	 * Resolved base URL for the Xernerx Suite API without a trailing slash.
	 */
	public readonly url: string;

	/**
	 * Creates a new {@link BaseClient} instance.
	 *
	 * @param token - Optional Xernerx Suite API bearer token.
	 * @param options - Client URL and environment configuration options.
	 */
	constructor(token = '', options: BaseClientOptions = {}) {
		this.token = token;
		const envUrl =
			typeof process !== 'undefined' && process.env?.API_URL
				? process.env.API_URL
				: typeof process !== 'undefined' && process.env?.ENVIRONMENT?.toUpperCase() === 'CANARY'
					? 'https://api.canary.xernerx.com'
					: 'https://api.xernerx.com';
		this.url = (options.url ?? (options.dev ? 'http://localhost:4001' : envUrl)).replace(/\/$/, '');
	}
}
