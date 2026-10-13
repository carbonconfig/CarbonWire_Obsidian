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
	dispose(): void;
}
