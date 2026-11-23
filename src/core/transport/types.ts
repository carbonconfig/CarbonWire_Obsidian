import type { Header } from "../model";

export interface TransportRequest {
	method: string;
	url: string;
	headers: readonly Header[];
	body?: Uint8Array;
	/** 0 disables the timeout. */
	timeoutMs: number;
	followRedirects: boolean;
	maxRedirects: number;
	forwardAuthorizationHeader: boolean;
	rejectUnauthorized: boolean;
	/** Bytes kept in memory; the rest is counted but discarded. */
	maxBodyBytes: number;
	signal?: AbortSignal;
	onProgress?: (progress: SendProgress) => void;
	/** HTTP/1.1 unless asked; "auto" lets TLS (ALPN) pick HTTP/2 when the server offers it. */
	httpVersion?: "http1" | "http2" | "auto";
	/** TLS versions not to offer, such as "TLSv1.2", and the cipher suites to offer. */
	disabledTlsVersions?: readonly string[];
	ciphers?: readonly string[];
	/** Keep the method and body on a 301, 302 or 303. */
	keepMethod?: boolean;
	/** Default headers (user-agent, accept, accept-encoding) to leave out, lower case. */
	omitHeaders?: readonly string[];
	/** Cookies sent with each hop, and those each hop sets, including redirects. */
	cookies?: CookieHooks;
	/**
	 * Requests with the same key go over one connection no other request uses, as NTLM needs.
	 * Release it with `Transport.release` when done.
	 */
	connection?: object;
}

export interface CookieHooks {
	header(url: URL): string | undefined;
	store(url: URL, setCookies: readonly string[]): void;
}

/** What the request looked like on the wire, on its last hop. */
export interface SentOnWire {
	method: string;
	url: string;
	headers: Header[];
}

export interface CertificateInfo {
	subject: string;
	issuer: string;
	validFrom: string;
	validTo: string;
	fingerprint256: string;
	subjectAltName?: string;
}

export interface TlsDetails {
	protocol?: string;
	cipher?: string;
	/** The server's certificate first, then its issuers. */
	certificates: CertificateInfo[];
	authorized: boolean;
	authorizationError?: string;
}

/** Where a request is up to, for showing progress. */
export type SendPhase = "authorizing" | "connecting" | "securing" | "sending" | "waiting" | "downloading";

export interface SendProgress {
	phase: SendPhase;
	/** Body bytes received so far, as sent over the wire. */
	received?: number;
	/** From Content-Length, when the server sends it. */
	total?: number;
}

/** Phase durations in milliseconds. DNS, connect and TLS are 0 on a reused connection. */
export interface Timings {
	dns: number;
	connect: number;
	tls: number;
	wait: number;
	download: number;
	total: number;
	reusedConnection: boolean;
}

export interface Redirect {
	status: number;
	url: string;
}

export interface TransportResponse {
	url: string;
	status: number;
	statusText: string;
	httpVersion: string;
	headers: Header[];
	body: Uint8Array;
	/** Decoded body size, including any bytes dropped past `maxBodyBytes`. */
	bodyBytes: number;
	truncated: boolean;
	timings: Timings;
	redirects: Redirect[];
	remoteAddress?: string;
	remotePort?: number;
	tls?: TlsDetails;
	/** The last hop as sent, with cookies and default headers added. */
	sent?: SentOnWire;
	/** Set when the request went through a proxy. */
	proxy?: string;
}

export type TransportErrorCode = "timeout" | "aborted" | "too-many-redirects" | "invalid-url" | "network";

export class TransportError extends Error {
	constructor(
		readonly code: TransportErrorCode,
		message: string,
		/** Underlying system code such as ENOTFOUND or CERT_HAS_EXPIRED. */
		readonly systemError?: { code?: string; message: string },
	) {
		super(message);
		this.name = "TransportError";
	}
}

export interface Transport {
	send(request: TransportRequest): Promise<TransportResponse>;
	/** Closes the connection kept for a `connection` key. */
	release?(connection: object): void;
	dispose(): void;
}
