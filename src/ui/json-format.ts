/* Below this size formatting is quicker than a round trip to the worker. */
const SYNC_LIMIT = 256 * 1024;

export function prettyJson(text: string): string | undefined {
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return undefined;
	}
}

/** Runs inside the worker, so it must not refer to anything outside itself. */
function workerMain(): void {
	const scope = self as unknown as { onmessage: ((e: MessageEvent<{ id: number; text: string }>) => void) | null; postMessage(message: unknown): void };
	scope.onmessage = (e) => {
		let pretty: string | null;
		try {
			pretty = JSON.stringify(JSON.parse(e.data.text), null, 2);
		} catch {
			pretty = null;
		}
		scope.postMessage({ id: e.data.id, pretty });
	};
}

let worker: Worker | undefined;
let workerUrl: string | undefined;
let nextId = 0;
const pending = new Map<number, (pretty: string | undefined) => void>();

function getWorker(): Worker | undefined {
	if (worker) return worker;
	try {
		workerUrl = URL.createObjectURL(new Blob([`(${workerMain.toString()})()`], { type: "text/javascript" }));
		worker = new Worker(workerUrl);
	} catch {
		return undefined;
	}
	worker.onmessage = (e: MessageEvent<{ id: number; pretty: string | null }>) => {
		pending.get(e.data.id)?.(e.data.pretty ?? undefined);
		pending.delete(e.data.id);
	};
	worker.onerror = () => {
		for (const resolve of pending.values()) resolve(undefined);
		pending.clear();
		disposeJsonWorker();
	};
	return worker;
}

/**
 * Pretty-prints JSON, or resolves to undefined when the text isn't JSON. Large bodies are
 * formatted in a worker so the interface stays responsive.
 */
export function formatJson(text: string): Promise<string | undefined> {
	const target = text.length > SYNC_LIMIT ? getWorker() : undefined;
	if (!target) return Promise.resolve(prettyJson(text));
	const id = nextId++;
	return new Promise((resolve) => {
		pending.set(id, resolve);
		target.postMessage({ id, text });
	});
}

export function disposeJsonWorker(): void {
	worker?.terminate();
	worker = undefined;
	if (workerUrl) URL.revokeObjectURL(workerUrl);
	workerUrl = undefined;
}
