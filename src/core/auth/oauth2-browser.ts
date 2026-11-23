import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { clearTimeout, setTimeout } from "node:timers";
import type { OAuth2AuthorizationCodeFlow, OAuth2ImplicitFlow } from "@opencollection/types/common/auth-oauth2";

/*
 * The OAuth 2.0 flows that go through a browser (authorization code, with PKCE, and implicit): the
 * system browser opens the authorization page, and a listener on a loopback address catches the
 * redirect (RFC 8252).
 */

/** How long the browser has to come back. */
export const SIGN_IN_WAIT_MS = 5 * 60_000;

export type BrowserFlow = OAuth2AuthorizationCodeFlow | OAuth2ImplicitFlow;

export interface Pkce {
	verifier: string;
	challenge: string;
	method: "S256" | "plain";
}

const random = (bytes: number) => randomBytes(bytes).toString("base64url");

/** A verifier and its challenge (RFC 7636); plain sends the verifier itself. */
export function pkce(plain: boolean): Pkce {
	const verifier = random(48);
	if (plain) return { verifier, challenge: verifier, method: "plain" };
	return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url"), method: "S256" };
}

/** PKCE as configured: on unless disabled, S256 unless plain is asked for. */
export function pkceOf(auth: BrowserFlow): Pkce | undefined {
	if (auth.flow !== "authorization_code" || auth.pkce?.disabled === true || auth.pkce === undefined) return undefined;
	return pkce(auth.pkce.method === "plain");
}

export class BrowserSignInError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BrowserSignInError";
	}
}

/** A listener for the redirect, and the redirect URI to send. */
export interface Callback {
	redirectUri: string;
	/** Waits for the browser's redirect and returns its parameters, after checking the state. */
	wait(state: string, signal?: AbortSignal): Promise<URLSearchParams>;
	close(): void;
}

const page = (title: string, text: string) =>
	`<!doctype html><meta charset=utf-8><title>CarbonWire</title><body style="font:16px system-ui;margin:4em"><h1>${title}</h1><p>${text}</p>`;
const DONE = page("Signed in", "You can close this tab and go back to CarbonWire.");
const FAILED = page("Sign-in didn't finish", "Go back to CarbonWire to see why.");
/** The implicit flow puts the token in the fragment, which only the page can read. */
const FRAGMENT =
	"<!doctype html><meta charset=utf-8><title>CarbonWire</title><script>if(location.hash.length>1){location.replace(location.pathname+'?'+location.hash.slice(1))}else{document.write('Nothing came back from the sign-in.')}</script>";

/**
 * Listens on the callback URL's loopback port, or on any free port when there's none. Callback URLs
 * that aren't on this computer can't be caught, so they're refused with what to register instead.
 */
export async function listen(callbackUrl: string | undefined): Promise<Callback> {
	let host = "127.0.0.1";
	let port = 0;
	let path = "/callback";
	let redirectUri: string | undefined = callbackUrl?.trim() || undefined;
	if (redirectUri) {
		let url: URL;
		try {
			url = new URL(redirectUri);
		} catch {
			throw new BrowserSignInError(`The callback URL ${redirectUri} isn't valid.`);
		}
		const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		if (!loopback) {
			throw new BrowserSignInError(
				`CarbonWire catches the redirect on this computer, so the callback URL must be http://127.0.0.1:<port>/... or http://localhost:<port>/...; ${redirectUri} isn't. Register one like that with the provider, or leave the field empty to use any free port.`,
			);
		}
		if (!url.port) throw new BrowserSignInError("The callback URL needs a port, such as http://127.0.0.1:8765/callback.");
		host = url.hostname === "[::1]" ? "::1" : "127.0.0.1";
		port = Number(url.port);
		path = url.pathname;
	}

	let resolveHit: ((params: URLSearchParams) => void) | undefined;
	const hits: URLSearchParams[] = [];
	const server: Server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		const reply = (body: string) => {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", Connection: "close" });
			res.end(body);
		};
		if (url.pathname !== path && !(path === "/" && url.pathname === "")) {
			res.writeHead(404).end();
			return;
		}
		if ([...url.searchParams].length === 0) return reply(FRAGMENT);
		reply(url.searchParams.has("error") || !url.searchParams.has("state") ? FAILED : DONE);
		if (resolveHit) resolveHit(url.searchParams);
		else hits.push(url.searchParams);
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", (e: NodeJS.ErrnoException) => reject(new BrowserSignInError(`Port ${port} for the callback can't be used: ${e.message}`)));
		server.listen(port, host, resolve);
	});
	if (!redirectUri) redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`;

	return {
		redirectUri,
		close: () => server.close(),
		wait: (state, signal) =>
			new Promise<URLSearchParams>((resolve, reject) => {
				const timer = setTimeout(() => finish(new BrowserSignInError("The sign-in in the browser didn't finish within 5 minutes.")), SIGN_IN_WAIT_MS);
				const onAbort = () => finish(new BrowserSignInError("Sign-in cancelled."));
				signal?.addEventListener("abort", onAbort, { once: true });
				const finish = (result: URLSearchParams | Error) => {
					clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);
					server.close();
					resolveHit = undefined;
					if (result instanceof Error) reject(result);
					else resolve(result);
				};
				const check = (params: URLSearchParams) => {
					if (params.get("state") !== state) return finish(new BrowserSignInError("The sign-in came back with a different state, so it was refused."));
					const error = params.get("error");
					if (error) return finish(new BrowserSignInError(`The sign-in was refused: ${params.get("error_description") ?? error}`));
					finish(params);
				};
				const early = hits.shift();
				if (early) check(early);
				else resolveHit = check;
			}),
	};
}

/** The authorization page's URL. */
export function authorizationUrl(auth: BrowserFlow, responseType: "code" | "token", redirectUri: string, state: string, challenge?: Pkce): string {
	const base = auth.authorizationUrl?.trim();
	if (!base) throw new BrowserSignInError("The authorization URL is empty.");
	const params = new URLSearchParams({ response_type: responseType, client_id: auth.credentials?.clientId ?? "", redirect_uri: redirectUri, state });
	if (auth.scope) params.set("scope", auth.scope);
	if (challenge) {
		params.set("code_challenge", challenge.challenge);
		params.set("code_challenge_method", challenge.method);
	}
	for (const p of auth.additionalParameters?.authorizationRequest ?? []) if (p.name) params.append(p.name, p.value ?? "");
	return `${base}${base.includes("?") ? "&" : "?"}${params}`;
}

export function newState(auth: BrowserFlow): string {
	return auth.state?.trim() || random(16);
}
