import type { Auth, DefaultsChain, Header, HttpRequestHeader, HttpRequestSettings } from "./model";

/**
 * A missing auth means "no auth" at every level; only `inherit` walks up the tree.
 * A folder without a folder.yml (undefined in the chain) is skipped.
 */
export function resolveAuth(requestAuth: Auth | undefined, chain: DefaultsChain): Exclude<Auth, "inherit"> | undefined {
	if (requestAuth !== "inherit") return requestAuth;
	for (let i = chain.length - 1; i >= 0; i--) {
		const defaults = chain[i];
		if (defaults === undefined || defaults.auth === "inherit") continue;
		return defaults.auth;
	}
	return undefined;
}

/** Collection → folders → request, with inner levels replacing outer headers of the same name. */
export function mergeHeaders(chain: DefaultsChain, requestHeaders: readonly HttpRequestHeader[] | undefined): Header[] {
	const merged = new Map<string, Header>();
	const add = (headers: readonly HttpRequestHeader[] | undefined) => {
		for (const h of headers ?? []) {
			if (h.disabled || !h.name) continue;
			merged.set(h.name.toLowerCase(), [h.name, h.value]);
		}
	};
	for (const defaults of chain) add(defaults?.headers);
	add(requestHeaders);
	return [...merged.values()];
}

/**
 * Postman's request settings that OpenCollection lacks. They're kept in the collection's sidecar
 * and carried in a level's settings by their Postman names.
 */
export const EXTRA_SETTINGS = ["strictSSL", "disableCookies", "protocolVersion", "followOriginalHttpMethod", "tlsDisabledProtocols", "tlsCipherSelection"] as const;
export type ExtraSetting = (typeof EXTRA_SETTINGS)[number];

/** A level's HTTP settings with the sidecar's extras merged in. */
export type LevelSettings = HttpRequestSettings & {
	strictSSL?: boolean;
	disableCookies?: boolean;
	protocolVersion?: "http1" | "http2" | "auto";
	followOriginalHttpMethod?: boolean;
	tlsDisabledProtocols?: string[];
	tlsCipherSelection?: string[];
};

export type HttpVersion = "http1" | "http2" | "auto";

export interface EffectiveSettings {
	encodeUrl: boolean;
	/** Milliseconds; 0 disables the timeout. */
	timeout: number;
	followRedirects: boolean;
	forwardAuthorizationHeader: boolean;
	maxRedirects: number;
	/** Default headers to leave out, lower case. */
	omitHeaders: string[];
	/** False when `strictSSL: false`: certificates aren't checked for this request. */
	verifyTls: boolean;
	useCookies: boolean;
	httpVersion: HttpVersion;
	/** TLS versions not to offer, such as "TLSv1.2". */
	disabledTlsVersions: string[];
	/** Cipher suites to offer, by OpenSSL or IANA name; empty offers Node's defaults. */
	ciphers: string[];
	/** Keep the method and body on a 301, 302 or 303. */
	keepMethod: boolean;
}

export const DEFAULT_SETTINGS: EffectiveSettings = {
	encodeUrl: true,
	timeout: 0,
	followRedirects: true,
	forwardAuthorizationHeader: false,
	maxRedirects: 5,
	omitHeaders: [],
	verifyTls: true,
	useCookies: true,
	httpVersion: "http1",
	disabledTlsVersions: [],
	ciphers: [],
	keepMethod: false,
};

/** The innermost level that sets a value wins; "inherit" defers outward. */
export function resolveSettings(chain: DefaultsChain, request: LevelSettings | undefined): EffectiveSettings {
	const levels: (LevelSettings | undefined)[] = [...chain.map((d) => d?.settings?.http), request];
	const find = <T>(read: (level: LevelSettings) => T | undefined): T | undefined => {
		for (let i = levels.length - 1; i >= 0; i--) {
			const level = levels[i];
			const value = level && read(level);
			if (value !== undefined && (value as unknown) !== "inherit") return value;
		}
		return undefined;
	};
	const list = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined);
	const bool = (value: unknown) => (typeof value === "boolean" ? value : undefined);
	const version = find((l) => (l.protocolVersion === "http1" || l.protocolVersion === "http2" || l.protocolVersion === "auto" ? l.protocolVersion : undefined));
	return {
		encodeUrl: find((l) => bool(l.encodeUrl)) ?? DEFAULT_SETTINGS.encodeUrl,
		timeout: find((l) => (typeof l.timeout === "number" ? l.timeout : undefined)) ?? DEFAULT_SETTINGS.timeout,
		followRedirects: find((l) => bool(l.followRedirects)) ?? DEFAULT_SETTINGS.followRedirects,
		forwardAuthorizationHeader: find((l) => bool(l.forwardAuthorizationHeader)) ?? DEFAULT_SETTINGS.forwardAuthorizationHeader,
		maxRedirects: find((l) => (typeof l.maxRedirects === "number" ? l.maxRedirects : undefined)) ?? DEFAULT_SETTINGS.maxRedirects,
		omitHeaders: (find((l) => list(l.omitHeaders)) ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean),
		verifyTls: find((l) => bool(l.strictSSL)) !== false,
		useCookies: find((l) => bool(l.disableCookies)) !== true,
		httpVersion: version ?? DEFAULT_SETTINGS.httpVersion,
		disabledTlsVersions: find((l) => list(l.tlsDisabledProtocols)) ?? [],
		ciphers: find((l) => list(l.tlsCipherSelection)) ?? [],
		keepMethod: find((l) => bool(l.followOriginalHttpMethod)) === true,
	};
}
