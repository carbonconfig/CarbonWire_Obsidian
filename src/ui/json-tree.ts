export interface JsonRow {
	/** JSONPath of the value, such as $.users[0].name. */
	path: string;
	/** Property name or array index; undefined for the root. */
	key?: string | number;
	depth: number;
	value: unknown;
	/** Number of children for objects and arrays; undefined for other values. */
	size?: number;
	open: boolean;
	/** Display text for strings, numbers, booleans and null. */
	preview?: string;
}

const PREVIEW_LIMIT = 1000;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function childPath(parent: string, key: string | number): string {
	if (typeof key === "number") return `${parent}[${key}]`;
	return IDENTIFIER.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

/** The rows a tree shows for `value` with the given paths expanded, in display order. */
export function flattenJson(value: unknown, expanded: { has(path: string): boolean }): JsonRow[] {
	const rows: JsonRow[] = [];
	const visit = (node: unknown, path: string, key: string | number | undefined, depth: number) => {
		if (Array.isArray(node)) {
			const open = expanded.has(path);
			rows.push({ path, key, depth, value: node, size: node.length, open });
			if (open) node.forEach((child, i) => visit(child, childPath(path, i), i, depth + 1));
			return;
		}
		if (node !== null && typeof node === "object") {
			const keys = Object.keys(node);
			const open = expanded.has(path);
			rows.push({ path, key, depth, value: node, size: keys.length, open });
			if (open) for (const k of keys) visit((node as Record<string, unknown>)[k], childPath(path, k), k, depth + 1);
			return;
		}
		const text = typeof node === "string" ? JSON.stringify(node) : String(node);
		rows.push({ path, key, depth, value: node, open: false, preview: text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}…` : text });
	};
	visit(value, "$", undefined, 0);
	return rows;
}
