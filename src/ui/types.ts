/** One send in the console: the request as it went out, and what came back. */
export interface ConsoleEntry {
	id: number;
	time: number;
	name: string;
	/** The request's file, for a saved request. */
	source?: string;
	method: string;
	url: string;
	requestHeaders: (readonly [string, string])[];
	requestBody?: string;
	requestBytes: number;
	status?: number;
	statusText?: string;
	httpVersion?: string;
	responseHeaders?: (readonly [string, string])[];
	/** The start of the response body, when it's text. */
	responseBody?: string;
	responseBytes?: number;
	durationMs?: number;
	redirects?: { status: number; url: string }[];
	remoteAddress?: string;
	proxy?: string;
	tls?: { protocol?: string; cipher?: string };
	error?: string;
}
