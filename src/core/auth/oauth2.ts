import type {
	AuthOAuth2,
	OAuth2AdditionalParameter,
	OAuth2AuthorizationCodeFlow,
	OAuth2ClientCredentialsFlow,
	OAuth2ResourceOwnerPasswordFlow,
} from "@opencollection/types/common/auth-oauth2";
import type { Header } from "../model";
import type { Transport, TransportResponse } from "../transport/types";

export interface TokenSet {
	accessToken: string;
	idToken?: string;
	refreshToken?: string;
	tokenType?: string;
	/** Epoch milliseconds. */
	expiresAt?: number;
}

export interface TokenRequestOptions {
	rejectUnauthorized: boolean;
	signal?: AbortSignal;
}

export class OAuth2Error extends Error {
	constructor(message: string, readonly response?: TransportResponse) {
		super(message);
		this.name = "OAuth2Error";
	}
}

const EXPIRY_SKEW_MS = 30_000;

type TokenFlow = OAuth2ClientCredentialsFlow | OAuth2ResourceOwnerPasswordFlow | OAuth2AuthorizationCodeFlow;

/** What the browser flows need from the app: opening the system browser on a URL. */
export interface BrowserHost {
	open(url: string): Promise<void>;
	/** Makes the loopback redirect reachable from the browser, e.g. by forwarding its port. */
	prepare?(redirectUri: string): Promise<void>;
}

/**
 * Fetches and caches tokens: client credentials and password directly, authorization code and
 * implicit through the system browser.
 */
export class OAuth2Tokens {
	private readonly cache = new Map<string, TokenSet>();
	/** Sign-ins in progress, so concurrent sends share one browser round trip. */
	private readonly pending = new Map<string, Promise<TokenSet>>();

	constructor(
		private readonly transport: Transport,
		private readonly browser?: BrowserHost,
	) {}

	clear(): void {
		this.cache.clear();
	}

	async token(auth: AuthOAuth2, options: TokenRequestOptions): Promise<TokenSet> {
		const key = cacheKey(auth);
		const cached = this.cache.get(key);
		if (cached && (cached.expiresAt === undefined || cached.expiresAt - EXPIRY_SKEW_MS > Date.now())) return cached;
		const running = this.pending.get(key);
		if (running) return running;
		const fetching = this.fetch(auth, cached, options).finally(() => this.pending.delete(key));
		this.pending.set(key, fetching);
		const token = await fetching;
		this.cache.set(key, token);
		return token;
	}

	private async fetch(auth: AuthOAuth2, cached: TokenSet | undefined, options: TokenRequestOptions): Promise<TokenSet> {
		if (auth.flow === "implicit") return this.implicit(auth, options);
		if (!auth.accessTokenUrl) throw new OAuth2Error("The OAuth 2.0 access token URL is empty.");
		if (cached?.refreshToken && auth.settings?.autoRefreshToken !== false) {
			const refreshed = await this.request(auth, auth.refreshTokenUrl || auth.accessTokenUrl, {
				grant_type: "refresh_token",
				refresh_token: cached.refreshToken,
			}, auth.additionalParameters?.refreshTokenRequest, options).catch(() => undefined);
			if (refreshed) return { ...refreshed, refreshToken: refreshed.refreshToken ?? cached.refreshToken };
		}
		if (auth.flow === "authorization_code") return this.authorizationCode(auth, options);
		const grant: Record<string, string> = { grant_type: auth.flow === "client_credentials" ? "client_credentials" : "password" };
		if (auth.flow === "resource_owner_password_credentials") {
			grant.username = auth.resourceOwner?.username ?? "";
			grant.password = auth.resourceOwner?.password ?? "";
		}
		return this.request(auth, auth.accessTokenUrl, grant, auth.additionalParameters?.accessTokenRequest, options);
	}

	private async signIn(auth: Extract<AuthOAuth2, { flow: "authorization_code" | "implicit" }>, responseType: "code" | "token", options: TokenRequestOptions) {
		if (!this.browser) throw new OAuth2Error(`The OAuth 2.0 "${auth.flow}" flow needs a browser, which isn't available here.`);
		const { authorizationUrl, listen, newState, pkceOf } = await import("./oauth2-browser");
		const callback = await listen(auth.callbackUrl);
		try {
			const state = newState(auth);
			const challenge = responseType === "code" ? pkceOf(auth) : undefined;
			await this.browser.prepare?.(callback.redirectUri);
			const waiting = callback.wait(state, options.signal);
			await this.browser.open(authorizationUrl(auth, responseType, callback.redirectUri, state, challenge));
			return { params: await waiting, redirectUri: callback.redirectUri, challenge };
		} catch (e) {
			callback.close();
			throw e instanceof OAuth2Error ? e : new OAuth2Error(e instanceof Error ? e.message : String(e));
		}
	}

	private async authorizationCode(auth: OAuth2AuthorizationCodeFlow, options: TokenRequestOptions): Promise<TokenSet> {
		const { params, redirectUri, challenge } = await this.signIn(auth, "code", options);
		const code = params.get("code");
		if (!code) throw new OAuth2Error("The sign-in came back without an authorization code.");
		const grant: Record<string, string> = { grant_type: "authorization_code", code, redirect_uri: redirectUri };
		if (challenge) grant.code_verifier = challenge.verifier;
		return this.request(auth, auth.accessTokenUrl!, grant, auth.additionalParameters?.accessTokenRequest, options);
	}

	private async implicit(auth: Extract<AuthOAuth2, { flow: "implicit" }>, options: TokenRequestOptions): Promise<TokenSet> {
		const { params } = await this.signIn(auth, "token", options);
		const accessToken = params.get("access_token");
		if (!accessToken) throw new OAuth2Error("The sign-in came back without an access token.");
		const expiresIn = Number(params.get("expires_in"));
		return {
			accessToken,
			idToken: params.get("id_token") ?? undefined,
			tokenType: params.get("token_type") ?? undefined,
			expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
		};
	}

	private async request(
		auth: TokenFlow,
		url: string,
		grant: Record<string, string>,
		extra: readonly OAuth2AdditionalParameter[] | undefined,
		options: TokenRequestOptions,
	): Promise<TokenSet> {
		const form = new URLSearchParams(grant);
		if (auth.scope) form.set("scope", auth.scope);
		const headers: Header[] = [
			["Content-Type", "application/x-www-form-urlencoded"],
			["Accept", "application/json"],
		];

		const clientId = auth.credentials?.clientId ?? "";
		const clientSecret = auth.credentials?.clientSecret ?? "";
		if (auth.credentials?.placement === "body") {
			form.set("client_id", clientId);
			if (clientSecret) form.set("client_secret", clientSecret);
		} else if (clientId) {
			// RFC 6749 §2.3.1: credentials are form-encoded before being joined for Basic auth.
			const basic = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;
			headers.push(["Authorization", `Basic ${Buffer.from(basic).toString("base64")}`]);
		}

		const target = new URL(url);
		for (const p of extra ?? []) {
			if (!p.name) continue;
			const value = p.value ?? "";
			if (p.placement === "header") headers.push([p.name, value]);
			else if (p.placement === "query") target.searchParams.append(p.name, value);
			else form.append(p.name, value);
		}

		const response = await this.transport.send({
			method: "POST",
			url: target.toString(),
			headers,
			body: new TextEncoder().encode(form.toString()),
			timeoutMs: 30_000,
			followRedirects: true,
			maxRedirects: 5,
			forwardAuthorizationHeader: false,
			rejectUnauthorized: options.rejectUnauthorized,
			maxBodyBytes: 1_000_000,
			signal: options.signal,
		});
		const text = new TextDecoder().decode(response.body);
		const data = parseTokenResponse(text);
		if (response.status >= 400 || typeof data.access_token !== "string") {
			const reason = typeof data.error_description === "string" ? data.error_description : typeof data.error === "string" ? data.error : text.slice(0, 200);
			throw new OAuth2Error(`Token request failed (${response.status}): ${reason}`, response);
		}
		const expiresIn = Number(data.expires_in);
		return {
			accessToken: data.access_token,
			idToken: typeof data.id_token === "string" ? data.id_token : undefined,
			refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
			tokenType: typeof data.token_type === "string" ? data.token_type : undefined,
			expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
		};
	}
}

/** Header name and value, or query key and value, for attaching a token to a request. */
export function tokenPlacement(auth: AuthOAuth2, token: TokenSet): { header: Header } | { query: [string, string] } {
	const value = auth.tokenConfig?.source === "id_token" ? (token.idToken ?? token.accessToken) : token.accessToken;
	const placement = auth.tokenConfig?.placement;
	if (placement && "query" in placement) return { query: [placement.query || "access_token", value] };
	const prefix = placement && "header" in placement ? placement.header : "Bearer";
	return { header: ["Authorization", prefix ? `${prefix} ${value}` : value] };
}

/** Some providers (e.g. GitHub without an Accept header) answer form-encoded instead of JSON. */
function parseTokenResponse(text: string): Record<string, unknown> {
	try {
		const json: unknown = JSON.parse(text);
		if (json && typeof json === "object") return json as Record<string, unknown>;
	} catch {
		// Fall through to form decoding.
	}
	return Object.fromEntries(new URLSearchParams(text));
}

function cacheKey(auth: AuthOAuth2): string {
	const username = auth.flow === "resource_owner_password_credentials" ? auth.resourceOwner?.username : undefined;
	const url = auth.flow === "implicit" ? auth.authorizationUrl : auth.accessTokenUrl;
	return JSON.stringify([auth.flow, url, auth.credentials?.clientId, auth.scope, username, auth.tokenConfig?.id]);
}
