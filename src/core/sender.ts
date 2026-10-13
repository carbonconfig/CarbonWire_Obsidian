import { digestAuthorization, parseDigestChallenge } from "./auth/digest";
import { tokenPlacement, type OAuth2Tokens } from "./auth/oauth2";
import { encodeBody, type FileReader } from "./body";
import { hasHeader, setHeader } from "./headers";
import type { Header, HttpRequest, Variable } from "./model";
import { appendQuery, type ResolvedRequest } from "./request-builder";
import type { RequestContext } from "./storage/store";
import type { SendProgress, Transport, TransportRequest, TransportResponse } from "./transport/types";
import { buildScope, type Scope } from "./variables";

export interface SendContext {
	transport: Transport;
	oauth2: OAuth2Tokens;
	readFile: FileReader;
	rejectUnauthorized: boolean;
	maxBodyBytes: number;
	signal?: AbortSignal;
	onProgress?: (progress: SendProgress) => void;
}

export interface SentRequest {
	method: string;
	url: string;
	headers: Header[];
	bodyBytes: number;
}

export interface SendResult {
	sent: SentRequest;
	response: TransportResponse;
	warnings: string[];
}

/** `environment` is the active environment, resolved with resolveEnvironment, secrets included. */
export function requestScope(context: RequestContext, request: HttpRequest, environment: readonly Variable[]): Scope {
	return buildScope({
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
	const url = resolved.url;
	const encoded = await encodeBody(resolved.body, ctx.readFile);
	if (encoded?.contentType) {
		// Multipart needs the generated boundary, so its content type always wins.
		if (resolved.body?.kind === "multipart") setHeader(headers, "Content-Type", encoded.contentType);
		else if (!hasHeader(headers, "content-type")) headers.push(["Content-Type", encoded.contentType]);
	}

	const auth = resolved.pendingAuth;
	const request: TransportRequest = {
		method: resolved.method,
		url,
		headers,
		body: encoded?.bytes,
		timeoutMs: resolved.settings.timeout,
		followRedirects: resolved.settings.followRedirects,
		maxRedirects: resolved.settings.maxRedirects,
		forwardAuthorizationHeader: resolved.settings.forwardAuthorizationHeader,
		rejectUnauthorized: ctx.rejectUnauthorized,
		maxBodyBytes: ctx.maxBodyBytes,
		signal: ctx.signal,
		onProgress: ctx.onProgress,
	};
	let response = await ctx.transport.send(request);

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

	return {
		sent: { method: resolved.method, url, headers, bodyBytes: encoded?.bytes.byteLength ?? 0 },
		response,
		warnings: resolved.warnings,
	};
}
