import type { Header, HttpRequest } from "../core/model";
import type { Timings, TransportResponse } from "../core/transport/types";

/* Bodies past this are cut short in history; the full size is still recorded. */
const BODY_LIMIT = 1024 * 1024;
const ENTRIES = "entries";
const BODIES = "bodies";

export interface HistoryResponse {
	status: number;
	statusText: string;
	headers: Header[];
	bodyBytes: number;
	/** The body was cut short, when sent or in history. */
	truncated: boolean;
	httpVersion: string;
	timings: Timings;
}

/**
 * One send. The request is kept as written, with variables unresolved, so secrets from
 * environments never reach history; the response is kept as received.
 */
export interface HistoryEntry {
	id: number;
	time: number;
	name: string;
	/** The request's file when it was sent, if it was saved. */
	source?: string;
	environment?: string;
	request: HttpRequest;
	response?: HistoryResponse;
	error?: string;
}

export type NewHistoryEntry = Omit<HistoryEntry, "id" | "response"> & { response?: TransportResponse };

/** Request history in IndexedDB: per device and vault, outside the vault so it doesn't sync. */
export class HistoryStore {
	private db?: Promise<IDBDatabase>;
	/** Newest first, once loaded. */
	private entries?: HistoryEntry[];

	constructor(
		private readonly name: string,
		private readonly limit: () => number,
		private readonly changed: () => void,
	) {}

	async list(): Promise<HistoryEntry[]> {
		if (!this.entries) {
			const db = await this.open();
			const all = await request<HistoryEntry[]>(db.transaction(ENTRIES).objectStore(ENTRIES).getAll());
			this.entries = all.sort((a, b) => b.id - a.id);
			await this.prune();
		}
		return this.entries;
	}

	async get(id: number): Promise<{ entry: HistoryEntry; body: Uint8Array } | undefined> {
		const entry = (await this.list()).find((e) => e.id === id);
		if (!entry) return undefined;
		const db = await this.open();
		const body = await request<Uint8Array | undefined>(db.transaction(BODIES).objectStore(BODIES).get(id));
		return { entry, body: body ?? new Uint8Array() };
	}

	/** The most recent send of a saved request. */
	async latestFor(source: string): Promise<HistoryEntry | undefined> {
		return (await this.list()).find((e) => e.source === source);
	}

	/** Keeps entries pointing at a request after it, or a folder above it, is renamed or moved. */
	async moveSource(from: string, to: string): Promise<void> {
		const moved = (await this.list()).filter((e) => e.source === from || e.source?.startsWith(`${from}/`));
		if (moved.length === 0) return;
		for (const entry of moved) entry.source = to + entry.source!.slice(from.length);
		const db = await this.open();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(ENTRIES, "readwrite");
			for (const entry of moved) tx.objectStore(ENTRIES).put(entry);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error ?? new Error("Couldn't update history."));
		});
		this.changed();
	}

	async add(next: NewHistoryEntry): Promise<void> {
		if (this.limit() <= 0) return;
		const entries = await this.list();
		const { response, ...rest } = next;
		const entry: Omit<HistoryEntry, "id"> = {
			...rest,
			response: response && {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
				bodyBytes: response.bodyBytes,
				truncated: response.truncated || response.body.byteLength > BODY_LIMIT,
				httpVersion: response.httpVersion,
				timings: response.timings,
			},
		};
		const db = await this.open();
		const id = await new Promise<number>((resolve, reject) => {
			const tx = db.transaction([ENTRIES, BODIES], "readwrite");
			const add = tx.objectStore(ENTRIES).add(entry);
			add.onsuccess = () => {
				if (response) tx.objectStore(BODIES).put(response.body.slice(0, BODY_LIMIT), add.result);
			};
			tx.oncomplete = () => resolve(add.result as number);
			tx.onerror = () => reject(tx.error ?? new Error("Couldn't save to history."));
		});
		entries.unshift({ ...entry, id });
		await this.prune();
		this.changed();
	}

	async remove(ids: readonly number[]): Promise<void> {
		if (ids.length === 0) return;
		const db = await this.open();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction([ENTRIES, BODIES], "readwrite");
			for (const id of ids) {
				tx.objectStore(ENTRIES).delete(id);
				tx.objectStore(BODIES).delete(id);
			}
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error ?? new Error("Couldn't update history."));
		});
		const removed = new Set(ids);
		this.entries = this.entries?.filter((e) => !removed.has(e.id));
		this.changed();
	}

	async clear(): Promise<void> {
		await this.remove((await this.list()).map((e) => e.id));
	}

	/** Drops the oldest entries past the limit, e.g. after the limit is lowered. */
	async prune(): Promise<void> {
		const entries = this.entries;
		const limit = Math.max(0, this.limit());
		if (entries && entries.length > limit) await this.remove(entries.slice(limit).map((e) => e.id));
	}

	close(): void {
		void this.db?.then((db) => db.close());
		this.db = undefined;
	}

	private open(): Promise<IDBDatabase> {
		this.db ??= new Promise((resolve, reject) => {
			const open = indexedDB.open(this.name, 1);
			open.onupgradeneeded = () => {
				open.result.createObjectStore(ENTRIES, { keyPath: "id", autoIncrement: true });
				open.result.createObjectStore(BODIES);
			};
			open.onsuccess = () => resolve(open.result);
			open.onerror = () => reject(open.error ?? new Error("Couldn't open history."));
		});
		return this.db;
	}
}

function request<T>(req: IDBRequest): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result as T);
		req.onerror = () => reject(req.error ?? new Error("History request failed."));
	});
}
