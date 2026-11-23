/* A cookie jar after RFC 6265: cookies set by responses are sent back with later requests. */

export interface Cookie {
	name: string;
	value: string;
	/** Lower case, without a leading dot. */
	domain: string;
	/** True when the cookie had no Domain attribute: only the exact host gets it. */
	hostOnly: boolean;
	path: string;
	/** Epoch milliseconds; undefined for a session cookie. */
	expires?: number;
	secure: boolean;
	httpOnly: boolean;
	sameSite?: string;
	created: number;
}

const MAX_COOKIES = 3000;

/** RFC 6265 §5.1.4: the directory of the request path. */
function defaultPath(pathname: string): string {
	if (!pathname.startsWith("/")) return "/";
	const last = pathname.lastIndexOf("/");
	return last <= 0 ? "/" : pathname.slice(0, last);
}

function domainMatches(host: string, domain: string): boolean {
	return host === domain || (host.endsWith(`.${domain}`) && !/^[\d.]+$/.test(host) && !host.includes(":"));
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
	if (requestPath === cookiePath) return true;
	if (!requestPath.startsWith(cookiePath)) return false;
	return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

function hostOf(url: URL): string {
	return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

/** Parses one Set-Cookie header for `url`; undefined when the cookie isn't allowed for it. */
export function parseSetCookie(header: string, url: URL, now = Date.now()): Cookie | undefined {
	const [pair = "", ...attributes] = header.split(";");
	const eq = pair.indexOf("=");
	const name = (eq >= 0 ? pair.slice(0, eq) : "").trim();
	const value = (eq >= 0 ? pair.slice(eq + 1) : pair).trim();
	if (!name && !value) return undefined;
	const host = hostOf(url);
	const cookie: Cookie = { name, value, domain: host, hostOnly: true, path: defaultPath(url.pathname), secure: false, httpOnly: false, created: now };
	let maxAge: number | undefined;
	let expires: number | undefined;
	for (const attribute of attributes) {
		const at = attribute.indexOf("=");
		const key = (at >= 0 ? attribute.slice(0, at) : attribute).trim().toLowerCase();
		const val = at >= 0 ? attribute.slice(at + 1).trim() : "";
		switch (key) {
			case "domain": {
				const domain = val.replace(/^\./, "").toLowerCase();
				if (!domain) break;
				// A cookie for another site, or for a whole top-level domain, is refused.
				if (!domainMatches(host, domain) || (!domain.includes(".") && domain !== host)) return undefined;
				cookie.domain = domain;
				cookie.hostOnly = false;
				break;
			}
			case "path":
				cookie.path = val.startsWith("/") ? val : defaultPath(url.pathname);
				break;
			case "max-age": {
				const seconds = Number(val);
				if (/^-?\d+$/.test(val)) maxAge = seconds;
				break;
			}
			case "expires": {
				const time = Date.parse(val);
				if (!Number.isNaN(time)) expires = time;
				break;
			}
			case "secure":
				cookie.secure = true;
				break;
			case "httponly":
				cookie.httpOnly = true;
				break;
			case "samesite":
				cookie.sameSite = val;
				break;
		}
	}
	if (maxAge !== undefined) cookie.expires = maxAge <= 0 ? 0 : now + maxAge * 1000;
	else if (expires !== undefined) cookie.expires = expires;
	return cookie;
}

export class CookieJar {
	private cookies: Cookie[] = [];

	constructor(cookies: readonly Cookie[] = [], private readonly onChange?: () => void) {
		this.cookies = [...cookies];
	}

	/** Unexpired cookies, for saving and for the cookie manager. */
	all(now = Date.now()): Cookie[] {
		return this.cookies.filter((c) => c.expires === undefined || c.expires > now);
	}

	get size(): number {
		return this.cookies.length;
	}

	/** Stores the cookies a response set; returns those it kept. */
	store(url: URL, setCookies: readonly string[], now = Date.now()): Cookie[] {
		const kept: Cookie[] = [];
		for (const header of setCookies) {
			const cookie = parseSetCookie(header, url, now);
			if (!cookie) continue;
			// A secure cookie can only be set over HTTPS.
			if (cookie.secure && url.protocol !== "https:") continue;
			this.put(cookie, now);
			kept.push(cookie);
		}
		if (kept.length > 0) this.onChange?.();
		return kept;
	}

	/** Adds or replaces a cookie, as if `url` had set it, e.g. from the cookie manager. */
	set(url: URL, header: string, now = Date.now()): Cookie | undefined {
		const cookie = parseSetCookie(header, url, now);
		if (!cookie) return undefined;
		this.put(cookie, now);
		this.onChange?.();
		return cookie;
	}

	/** The Cookie header for a request to `url`, or undefined when no cookie applies. */
	header(url: URL, now = Date.now()): string | undefined {
		if (this.cookies.length === 0) return undefined;
		const host = hostOf(url);
		const secure = url.protocol === "https:";
		const path = url.pathname || "/";
		const matching = this.cookies.filter(
			(c) =>
				(c.expires === undefined || c.expires > now) &&
				(c.hostOnly ? host === c.domain : domainMatches(host, c.domain)) &&
				pathMatches(path, c.path) &&
				(!c.secure || secure || host === "localhost" || host === "127.0.0.1"),
		);
		if (matching.length === 0) return undefined;
		// Longer paths first, then older cookies first (RFC 6265 §5.4).
		matching.sort((a, b) => b.path.length - a.path.length || a.created - b.created);
		return matching.map((c) => (c.name ? `${c.name}=${c.value}` : c.value)).join("; ");
	}

	delete(predicate: (cookie: Cookie) => boolean): number {
		const before = this.cookies.length;
		this.cookies = this.cookies.filter((c) => !predicate(c));
		const removed = before - this.cookies.length;
		if (removed > 0) this.onChange?.();
		return removed;
	}

	clear(): void {
		this.delete(() => true);
	}

	private put(cookie: Cookie, now: number): void {
		const i = this.cookies.findIndex((c) => c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path);
		const expired = cookie.expires !== undefined && cookie.expires <= now;
		if (i >= 0) {
			if (expired) this.cookies.splice(i, 1);
			else this.cookies[i] = { ...cookie, created: this.cookies[i]!.created };
		} else if (!expired) {
			this.cookies.push(cookie);
			if (this.cookies.length > MAX_COOKIES) {
				this.cookies = this.all(now);
				this.cookies.splice(0, this.cookies.length - MAX_COOKIES);
			}
		}
	}
}
