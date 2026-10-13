import type { HttpRequest } from "../core/model";
import type { SendResult } from "../core/sender";
import type { SendProgress } from "../core/transport/types";
import type { RequestLayout } from "../settings";

export interface RequestController {
	/** Saves the file, or for an unsaved request, keeps it in the tab's state. */
	save(request: HttpRequest): Promise<void>;
	/** Asks where to save an unsaved request; resolves to its name, or undefined if cancelled. */
	saveDraft(name: string, request: HttpRequest): Promise<string | undefined>;
	send(name: string, request: HttpRequest, signal: AbortSignal, onProgress: (progress: SendProgress) => void): Promise<SendResult>;
	openEnvironment(path: string): void;
	setLayout(layout: RequestLayout): void;
	setWrap(wrap: boolean): void;
	/** Variables defined for this request with the active environment. */
	variableNames(request: HttpRequest): Promise<string[]>;
	/** Renames the request; resolves to the name actually used, or undefined if it failed. */
	rename(name: string): Promise<string | undefined>;
	/** Copies the request, fully resolved, as a cURL command. */
	copyCurl(request: HttpRequest): Promise<void>;
	notify(message: string): void;
}
