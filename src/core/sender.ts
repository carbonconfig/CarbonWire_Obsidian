import { digestAuthorization, parseDigestChallenge } from "./auth/digest";
import { tokenPlacement, type OAuth2Tokens } from "./auth/oauth2";
import { encodeBody, type FileReader } from "./body";
import { hasHeader, setHeader } from "./headers";
import type { Header, HttpRequest, Variable } from "./model";
import { appendQuery, type ResolvedRequest } from "./request-builder";
import type { RequestContext } from "./storage/store";
import type { CookieHooks, SendProgress, Transport, TransportRequest, TransportResponse } from "./transport/types";
import { signs } from "./auth/signs";
import { buildScope, type Scope } from "./variables";

export interface SendContext {
	transport: Transport;
	oauth2: OAuth2Tokens;
	readFile: FileReader;
	rejectUnauthorized: boolean;
	maxBodyBytes: number;
	signal?: AbortSignal;
	onProgress?: (progress: SendProgress) => void;
	/** The cookie jar; cookies are sent and stored unless the request turns them off. */
	cookies?: CookieHooks;
}

export interface SentRequest {
	method: string;
	url: string;
	headers: Header[];
	bodyBytes: number;
	/** The start of a text body, for the console. */
	bodyPreview?: string;
}

const PREVIEW_BYTES = 64 * 1024;

export interface SendResult {
	sent: SentRequest;
	response: TransportResponse;
	warnings: string[];
}

/** `environment` and `globals` are resolved with resolveEnvironment, secrets included. */
export function requestScope(context: RequestContext, request: HttpRequest, environment: readonly Variable[], globals?: readonly Variable[]): Scope {
	return buildScope({
		globals,
		collection: context.chain[0]?.variables,
		environment,
		folders: context.chain.slice(1).map((d) => d?.variables),
		request: request.runtime?.variables,
	});
}

/**
 * Fetches an OAuth 2.0 token if the request needs one and adds it, as sending would. Digest
 * needs the server's challenge, so it stays pending.
 */
export async function withOAuth2(resolved: ResolvedRequest, oauth2: OAuth2Tokens, options: { rejectUnauthorized: boolean; signal?: AbortSignal }): Promise<ResolvedRequest> {
	const auth = resolved.pendingAuth;
	if (auth?.type !== "oauth2") return resolved;
	const token = await oauth2.token(auth, options);
	const placement = tokenPlacement(auth, token);
	const headers = [...resolved.headers];
	let url = resolved.url;
	if ("header" in placement) setHeader(headers, ...placement.header);
	else url = appendQuery(url, [placement.query], resolved.settings.encodeUrl);
	return { ...resolved, headers, url, pendingAuth: undefined };
}

export async function sendRequest(unauthorized: ResolvedRequest, ctx: SendContext): Promise<SendResult> {
	if (unauthorized.pendingAuth?.type === "oauth2") ctx.onProgress?.({ phase: "authorizing" });
	const resolved = await withOAuth2(unauthorized, ctx.oauth2, { rejectUnauthorized: ctx.rejectUnauthorized, signal: ctx.signal });
	const headers = [...resolved.headers];
	let url = resolved.url;
	const encoded = await encodeBody(resolved.body, ctx.readFile);
	if (encoded?.contentType) {
		// Multipart needs the generated boundary, so its content type always wins.
		if (resolved.body?.kind === "multipart") setHeader(headers, "Content-Type", encoded.contentType);
		else if (!hasHeader(headers, "content-type")) headers.push(["Content-Type", encoded.contentType]);
	}

	const auth = resolved.pendingAuth;
	const { settings } = resolved;
	if (auth && signs(auth.type)) {
		const { signRequest } = await import("./auth/sign");
		const signable = { method: resolved.method, url, headers, body: encoded?.bytes ?? new Uint8Array() };
		signRequest(await withKeyFile(auth as Record<string, unknown>, ctx.readFile), signable);
		url = signable.url;
	}

	const request: TransportRequest = {
		method: resolved.method,
		url,
		headers,
		body: encoded?.bytes,
		timeoutMs: settings.timeout,
		followRedirects: settings.followRedirects,
		maxRedirects: settings.maxRedirects,
		forwardAuthorizationHeader: settings.forwardAuthorizationHeader,
		rejectUnauthorized: ctx.rejectUnauthorized && settings.verifyTls,
		maxBodyBytes: ctx.maxBodyBytes,
		signal: ctx.signal,
		onProgress: ctx.onProgress,
		httpVersion: settings.httpVersion,
		disabledTlsVersions: settings.disabledTlsVersions,
		ciphers: settings.ciphers,
		keepMethod: settings.keepMethod,
		omitHeaders: settings.omitHeaders,
		cookies: settings.useCookies ? ctx.cookies : undefined,
	};

	let response: TransportResponse;
	if (auth?.type === "ntlm") {
		response = await sendNtlm(request, auth, ctx.transport);
	} else {
		response = await ctx.transport.send(request);
		if (auth?.type === "digest" && response.status === 401) {
			const challenge = response.headers
				.filter(([n]) => n.toLowerCase() === "www-authenticate")
				.map(([, v]) => parseDigestChallenge(v))
				.find((c) => c !== undefined);
			if (challenge) {
				const target = new URL(url);
				setHeader(headers, "Authorization", digestAuthorization(challenge, {
					username: auth.username ?? "",
					password: auth.password ?? "",
					method: resolved.method,
					uri: target.pathname + target.search,
				}));
				response = await ctx.transport.send({ ...request, headers });
			}
		}
	}

	const sent = response.sent ?? { method: resolved.method, url, headers };
	const bodyPreview = encoded && resolved.body?.kind !== "file" ? new TextDecoder().decode(encoded.bytes.subarray(0, PREVIEW_BYTES)) : undefined;
	return {
		sent: { method: sent.method, url: sent.url, headers: sent.headers, bodyBytes: encoded?.bytes.byteLength ?? 0, bodyPreview },
		response,
		warnings: resolved.warnings,
	};
}

/** OAuth 1.0's private key can be a file; it's read before signing. */
async function withKeyFile(auth: Record<string, unknown>, readFile: FileReader): Promise<Record<string, unknown>> {
	const key = auth.privateKey as { type?: string; value?: string } | undefined;
	if (key?.type !== "file" || !key.value) return auth;
	return { ...auth, privateKey: new TextDecoder().decode(await readFile(key.value)) };
}

/**
 * NTLM's three messages go over one connection: negotiate, the server's challenge in a 401, then
 * the answer. A server that doesn't ask for NTLM gets the first response as it is.
 */
async function sendNtlm(request: TransportRequest, auth: { username?: string; password?: string; domain?: string }, transport: Transport): Promise<TransportResponse> {
	const { authenticate, challengeFromHeaders, negotiate } = await import("./auth/ntlm");
	const connection = {};
	try {
		const first = { ...request, connection, followRedirects: false, headers: [...request.headers] };
		setHeader(first.headers, "Authorization", `NTLM ${negotiate().toString("base64")}`);
		const challengeResponse = await transport.send(first);
		if (challengeResponse.status !== 401) return challengeResponse;
		const challenge = challengeFromHeaders(challengeResponse.headers.filter(([n]) => n.toLowerCase() === "www-authenticate").map(([, v]) => v));
		if (!challenge) return challengeResponse;
		let username = auth.username ?? "";
		let domain = auth.domain ?? "";
		// DOMAIN\user is accepted too.
		const slash = username.indexOf("\\");
		if (!domain && slash > 0) {
			domain = username.slice(0, slash);
			username = username.slice(slash + 1);
		}
		const answer = authenticate({ username, password: auth.password ?? "", domain, workstation: "" }, challenge);
		const headers = [...request.headers];
		setHeader(headers, "Authorization", `NTLM ${answer.toString("base64")}`);
		return await transport.send({ ...request, connection, headers });
	} finally {
		transport.release?.(connection);
	}
}
