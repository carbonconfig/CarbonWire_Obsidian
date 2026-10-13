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

export interface EffectiveSettings {
	encodeUrl: boolean;
	timeout: number;
	followRedirects: boolean;
	forwardAuthorizationHeader: boolean;
	maxRedirects: number;
}

export const DEFAULT_SETTINGS: EffectiveSettings = {
	encodeUrl: true,
	timeout: 0,
	followRedirects: true,
	forwardAuthorizationHeader: false,
	maxRedirects: 5,
};

export function resolveSettings(chain: DefaultsChain, request: HttpRequestSettings | undefined): EffectiveSettings {
	const levels = [...chain.map((d) => d?.settings?.http), request];
	const pick = <K extends keyof EffectiveSettings>(key: K): EffectiveSettings[K] => {
		for (let i = levels.length - 1; i >= 0; i--) {
			const value = levels[i]?.[key];
			if (value !== undefined && value !== "inherit") return value as EffectiveSettings[K];
		}
		return DEFAULT_SETTINGS[key];
	};
	return {
		encodeUrl: pick("encodeUrl"),
		timeout: pick("timeout"),
		followRedirects: pick("followRedirects"),
		forwardAuthorizationHeader: pick("forwardAuthorizationHeader"),
		maxRedirects: pick("maxRedirects"),
	};
}
