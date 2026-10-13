import type { CollectionNode, FolderNode, RequestNode } from "../core/storage/tree";

export type MenuTarget =
	| { kind: "collection"; collection: CollectionNode }
	| { kind: "folder"; collection: CollectionNode; folder: FolderNode }
	| { kind: "request"; collection: CollectionNode; request: RequestNode }
	| { kind: "environment"; path: string };

/** Short labels keep the method column narrow in the sidebar. */
export function methodLabel(method: string): string {
	const short: Record<string, string> = { DELETE: "DEL", OPTIONS: "OPT" };
	return short[method] ?? method;
}
