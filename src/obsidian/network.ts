import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { debounce, type App } from "obsidian";
import type { Cookie, CookieJar } from "../core/cookies";
import type { ClientCertificate } from "../core/transport/node";
import { bypasses, parseProxyUrl, proxyFromEnvironment, type ProxyTarget } from "../core/transport/proxy";
import type { CookieHooks } from "../core/transport/types";
import type { CarbonWireSettings } from "../settings";

/** A client certificate setting: a host pattern and PEM files or a PKCS #12 file. */
export interface CertificateSetting {
	host: string;
	certificate?: string;
	key?: string;
	pfx?: string;
}

interface LoadedCertificate extends ClientCertificate {
	host: string;
}

/** `host certificate.pem key.pem` or `host bundle.p12` lines; paths are relative to the vault unless absolute. */
export function parseCertificates(text: string): CertificateSetting[] {
	return text.split("\n").flatMap((line) => {
		const parts = line.trim().split(/\s+/).filter(Boolean);
		if (parts.length < 2 || line.trim().startsWith("#")) return [];
		const [host, first, second] = parts as [string, string, string | undefined];
		return [/\.(p12|pfx)$/i.test(first) && !second ? { host, pfx: first } : { host, certificate: first, key: second }];
	});
}

export function parseLines(text: string): string[] {
	return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

/* SecretStorage IDs are lower-case letters, digits and dashes. */
export const PROXY_SECRET = "carbonwire-proxy-password";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
export const certificateSecret = (host: string) => `carbonwire-certificate-${slug(host)}`;
const COOKIES_KEY = "carbonwire-cookies";

/** Whether a pattern such as api.example.com, *.example.com or host:8443 covers `url`. */
export function hostMatches(pattern: string, url: URL): boolean {
	const at = pattern.lastIndexOf(":");
	const [name, port] = at > 0 && /^\d+$/.test(pattern.slice(at + 1)) ? [pattern.slice(0, at), pattern.slice(at + 1)] : [pattern, undefined];
	const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (port && port !== (url.port || (url.protocol === "https:" ? "443" : "80"))) return false;
	const p = name.trim().toLowerCase();
	return p.startsWith("*.") ? host.endsWith(p.slice(1)) : host === p;
}

/**
 * Proxy, client certificates, extra certificate authorities and the cookie jar. Certificate files
 * are read once and kept in memory; passphrases and the proxy password live in Obsidian's secret
 * storage, never in the plugin's settings, which sync with the vault.
 */
export class Network {
	private certificates: LoadedCertificate[] = [];
	private ca?: { id: string; certs: string[] };
	private loaded?: Promise<void>;
	/** The settings the loaded certificates came from; a change reloads them. */
	private loadedFrom = "";
	/** Changes with each reload, so connections made with old certificates aren't reused. */
	private generation = 0;
	private jar?: CookieJar;
	private jarLoading?: Promise<CookieJar>;
	private readonly listeners = new Set<() => void>();
	private readonly saveJar = debounce(() => this.writeJar(), 1000, true);
	private readonly notify = debounce(() => {
		for (const listener of this.listeners) listener();
	}, 200, true);
	readonly problems: string[] = [];

	constructor(
		private readonly app: App,
		private readonly settings: () => CarbonWireSettings,
		/** Absolute path of a path relative to the vault. */
		private readonly resolvePath: (path: string) => string,
	) {}

	reload(): Promise<void> {
		this.loaded = this.load();
		return this.loaded;
	}

	/** Loads certificates on first use, and again after their settings change. */
	ready(): Promise<void> {
		const s = this.settings();
		if (JSON.stringify([s.clientCertificates, s.caCertificates]) !== this.loadedFrom) this.loaded = undefined;
		return (this.loaded ??= this.load());
	}

	proxyFor(url: URL): ProxyTarget | undefined {
		const s = this.settings();
		if (s.proxyMode === "environment") return proxyFromEnvironment(url);
		if (s.proxyMode !== "custom" || bypasses(s.proxyBypass, url)) return undefined;
		try {
			return parseProxyUrl(s.proxyUrl, this.app.secretStorage.getSecret(PROXY_SECRET) ?? undefined);
		} catch {
			return undefined;
		}
	}

	certificateFor(url: URL): ClientCertificate | undefined {
		return this.certificates.find((c) => hostMatches(c.host, url));
	}

	certificateAuthorities(): { id: string; certs: string[] } | undefined {
		return this.ca;
	}

	cookieJar(): Promise<CookieJar> {
		if (this.jar) return Promise.resolve(this.jar);
		return (this.jarLoading ??= this.readJar());
	}

	async cookieHooks(): Promise<CookieHooks> {
		const jar = await this.cookieJar();
		return { header: (url) => jar.header(url), store: (url, setCookies) => void jar.store(url, setCookies) };
	}

	/** Called when the jar changes; returns a function that stops listening. */
	onCookiesChanged(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	flush(): void {
		this.saveJar.run();
	}

	private async load(): Promise<void> {
		this.problems.length = 0;
		this.generation++;
		const s = this.settings();
		this.loadedFrom = JSON.stringify([s.clientCertificates, s.caCertificates]);
		const read = async (path: string | undefined, what: string): Promise<Buffer | undefined> => {
			if (!path?.trim()) return undefined;
			try {
				return await readFile(isAbsolute(path) ? path : this.resolvePath(path));
			} catch (e) {
				this.problems.push(`The ${what} ${path} can't be read: ${e instanceof Error ? e.message : String(e)}`);
				return undefined;
			}
		};
		const loaded: LoadedCertificate[] = [];
		for (const [i, c] of parseCertificates(s.clientCertificates).entries()) {
			const host = c.host?.trim();
			if (!host) continue;
			const [cert, key, pfx] = await Promise.all([read(c.certificate, "certificate"), read(c.key, "key"), read(c.pfx, "PKCS #12 file")]);
			if (!pfx && !(cert && key)) {
				if (!c.pfx && !c.certificate && !c.key) this.problems.push(`The client certificate for ${host} needs a certificate and key, or a PKCS #12 (.pfx, .p12) file.`);
				continue;
			}
			const passphrase = this.app.secretStorage.getSecret(certificateSecret(host)) ?? undefined;
			loaded.push({ id: `${this.generation}:${i}:${host}`, host, cert, key, pfx, passphrase });
		}
		this.certificates = loaded;
		const cas = (await Promise.all(parseLines(s.caCertificates).map((path) => read(path, "certificate authority")))).flatMap((b) => (b ? [b.toString()] : []));
		this.ca = cas.length > 0 ? { id: String(this.generation), certs: cas } : undefined;
	}

	/** Cookies are kept per vault on this device (Obsidian's local storage), never synced. */
	private async readJar(): Promise<CookieJar> {
		const saved: unknown = this.app.loadLocalStorage(COOKIES_KEY);
		const { CookieJar } = await import("../core/cookies");
		this.jar = new CookieJar(Array.isArray(saved) ? (saved as Cookie[]) : [], () => {
			this.saveJar();
			this.notify();
		});
		return this.jar;
	}

	private writeJar(): void {
		if (this.jar) this.app.saveLocalStorage(COOKIES_KEY, this.jar.all());
	}
}
