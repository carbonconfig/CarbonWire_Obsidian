/*
 * JSONPath (RFC 9535's essentials) for filtering JSON responses: names, wildcards, indexes,
 * slices, unions, descendants, and filters with comparisons, existence tests, &&, || and !.
 */

type Json = unknown;

type Selector =
	| { kind: "name"; name: string }
	| { kind: "wildcard" }
	| { kind: "index"; index: number }
	| { kind: "slice"; start?: number; end?: number; step?: number }
	| { kind: "filter"; expr: Expr };

interface Segment {
	descendant: boolean;
	selectors: Selector[];
}

type Expr =
	| { kind: "or" | "and"; left: Expr; right: Expr }
	| { kind: "not"; expr: Expr }
	| { kind: "compare"; op: string; left: Operand; right: Operand }
	| { kind: "exists"; path: Query };

type Operand = { kind: "literal"; value: Json } | { kind: "query"; query: Query };

interface Query {
	/** "$" for the root, "@" for the current node. */
	start: "$" | "@";
	segments: Segment[];
}

export class JsonPathError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JsonPathError";
	}
}

class Parser {
	private pos = 0;

	constructor(private readonly text: string) {}

	parse(): Query {
		this.space();
		if (this.text[this.pos] !== "$") throw this.error("A JSONPath starts with $");
		const query = this.query();
		this.space();
		if (this.pos < this.text.length) throw this.error(`Unexpected "${this.text[this.pos]}"`);
		return query;
	}

	private error(message: string): JsonPathError {
		return new JsonPathError(`${message} at position ${this.pos + 1}.`);
	}

	private space(): void {
		while (/\s/.test(this.text[this.pos] ?? "")) this.pos++;
	}

	private eat(token: string): boolean {
		if (this.text.startsWith(token, this.pos)) {
			this.pos += token.length;
			return true;
		}
		return false;
	}

	private query(): Query {
		const start = this.text[this.pos] as "$" | "@";
		this.pos++;
		const segments: Segment[] = [];
		for (;;) {
			const at = this.pos;
			this.space();
			if (this.eat("..")) {
				if (this.text[this.pos] === "[") segments.push({ descendant: true, selectors: this.bracket() });
				else segments.push({ descendant: true, selectors: [this.dotName()] });
			} else if (this.eat(".")) {
				segments.push({ descendant: false, selectors: [this.dotName()] });
			} else if (this.text[this.pos] === "[") {
				segments.push({ descendant: false, selectors: this.bracket() });
			} else {
				this.pos = at;
				return { start, segments };
			}
		}
	}

	private dotName(): Selector {
		if (this.eat("*")) return { kind: "wildcard" };
		const m = /^[A-Za-z_\u0080-￿][\w\u0080-￿-]*/.exec(this.text.slice(this.pos));
		if (!m) throw this.error("Expected a name");
		this.pos += m[0].length;
		return { kind: "name", name: m[0] };
	}

	private bracket(): Selector[] {
		this.pos++;
		const selectors: Selector[] = [];
		for (;;) {
			this.space();
			selectors.push(this.selector());
			this.space();
			if (this.eat("]")) return selectors;
			if (!this.eat(",")) throw this.error('Expected "," or "]"');
		}
	}

	private selector(): Selector {
		const c = this.text[this.pos];
		if (c === "'" || c === '"') return { kind: "name", name: this.string() };
		if (this.eat("*")) return { kind: "wildcard" };
		if (this.eat("?")) {
			this.space();
			return { kind: "filter", expr: this.or() };
		}
		const start = this.int();
		this.space();
		if (this.text[this.pos] !== ":") {
			if (start === undefined) throw this.error("Expected a selector");
			return { kind: "index", index: start };
		}
		this.pos++;
		this.space();
		const end = this.int();
		this.space();
		let step: number | undefined;
		if (this.eat(":")) {
			this.space();
			step = this.int();
		}
		return { kind: "slice", start, end, step };
	}

	private int(): number | undefined {
		const m = /^-?\d+/.exec(this.text.slice(this.pos));
		if (!m) return undefined;
		this.pos += m[0].length;
		return Number(m[0]);
	}

	private string(): string {
		const quote = this.text[this.pos++];
		let out = "";
		while (this.pos < this.text.length) {
			const c = this.text[this.pos++]!;
			if (c === quote) return out;
			if (c !== "\\") {
				out += c;
				continue;
			}
			const e = this.text[this.pos++];
			if (e === "u") {
				out += String.fromCharCode(parseInt(this.text.slice(this.pos, this.pos + 4), 16));
				this.pos += 4;
			} else {
				out += ({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" } as Record<string, string>)[e!] ?? e;
			}
		}
		throw this.error("Unterminated string");
	}

	private or(): Expr {
		let left = this.and();
		for (;;) {
			this.space();
			if (!this.eat("||")) return left;
			this.space();
			left = { kind: "or", left, right: this.and() };
		}
	}

	private and(): Expr {
		let left = this.unary();
		for (;;) {
			this.space();
			if (!this.eat("&&")) return left;
			this.space();
			left = { kind: "and", left, right: this.unary() };
		}
	}

	private unary(): Expr {
		this.space();
		if (this.eat("!")) {
			this.space();
			return { kind: "not", expr: this.unary() };
		}
		if (this.eat("(")) {
			const expr = this.or();
			this.space();
			if (!this.eat(")")) throw this.error('Expected ")"');
			return expr;
		}
		const left = this.operand();
		this.space();
		const op = /^(==|!=|<=|>=|<|>)/.exec(this.text.slice(this.pos))?.[0];
		if (!op) {
			if (left.kind !== "query") throw this.error("Expected a comparison");
			return { kind: "exists", path: left.query };
		}
		this.pos += op.length;
		this.space();
		return { kind: "compare", op, left, right: this.operand() };
	}

	private operand(): Operand {
		const c = this.text[this.pos];
		if (c === "@" || c === "$") return { kind: "query", query: this.query() };
		if (c === "'" || c === '"') return { kind: "literal", value: this.string() };
		for (const [word, value] of [["true", true], ["false", false], ["null", null]] as const) {
			if (this.eat(word)) return { kind: "literal", value };
		}
		const m = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(this.text.slice(this.pos));
		if (!m) throw this.error("Expected a value");
		this.pos += m[0].length;
		return { kind: "literal", value: Number(m[0]) };
	}
}

const isObject = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

function children(node: Json): Json[] {
	if (Array.isArray(node)) return node;
	if (isObject(node)) return Object.values(node);
	return [];
}

function descendants(node: Json, out: Json[]): void {
	out.push(node);
	for (const child of children(node)) descendants(child, out);
}

function select(node: Json, selector: Selector, root: Json, out: Json[]): void {
	switch (selector.kind) {
		case "name":
			if (isObject(node) && Object.hasOwn(node, selector.name)) out.push(node[selector.name]);
			return;
		case "wildcard":
			out.push(...children(node));
			return;
		case "index":
			if (Array.isArray(node)) {
				const i = selector.index < 0 ? node.length + selector.index : selector.index;
				if (i >= 0 && i < node.length) out.push(node[i]);
			}
			return;
		case "slice": {
			if (!Array.isArray(node)) return;
			const len = node.length;
			const step = selector.step ?? 1;
			if (step === 0) return;
			const norm = (i: number) => (i < 0 ? len + i : i);
			if (step > 0) {
				const start = Math.min(Math.max(norm(selector.start ?? 0), 0), len);
				const end = Math.min(Math.max(norm(selector.end ?? len), 0), len);
				for (let i = start; i < end; i += step) out.push(node[i]);
			} else {
				const start = Math.min(Math.max(norm(selector.start ?? len - 1), -1), len - 1);
				const end = Math.min(Math.max(selector.end === undefined ? -1 : norm(selector.end), -1), len - 1);
				for (let i = start; i > end; i += step) out.push(node[i]);
			}
			return;
		}
		case "filter":
			for (const child of children(node)) if (test(selector.expr, child, root)) out.push(child);
			return;
	}
}

function run(query: Query, current: Json, root: Json): Json[] {
	let nodes = [query.start === "$" ? root : current];
	for (const segment of query.segments) {
		const next: Json[] = [];
		const inputs: Json[] = [];
		if (segment.descendant) for (const n of nodes) descendants(n, inputs);
		else inputs.push(...nodes);
		for (const n of inputs) for (const s of segment.selectors) select(n, s, root, next);
		nodes = next;
	}
	return nodes;
}

/** A value, or undefined when a query selects nothing (RFC 9535's "Nothing"). */
type Found = { value: Json } | undefined;

function value(operand: Operand, current: Json, root: Json): Found {
	if (operand.kind === "literal") return { value: operand.value };
	const found = run(operand.query, current, root);
	return found.length === 1 ? { value: found[0] } : undefined;
}

function equal(a: Json, b: Json): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
	if (isObject(a) && isObject(b)) {
		const keys = Object.keys(a);
		return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]));
	}
	return false;
}

function compare(op: string, left: Found, right: Found): boolean {
	if (op === "==") return left === undefined || right === undefined ? left === right : equal(left.value, right.value);
	if (op === "!=") return !compare("==", left, right);
	if (left === undefined || right === undefined) return false;
	const a = left.value;
	const b = right.value;
	if (typeof a === "number" && typeof b === "number") return order(op, a, b);
	if (typeof a === "string" && typeof b === "string") return order(op, a, b);
	return (op === "<=" || op === ">=") && equal(a, b);
}

function order<T extends number | string>(op: string, x: T, y: T): boolean {
	return op === "<" ? x < y : op === ">" ? x > y : op === "<=" ? x <= y : x >= y;
}

function test(expr: Expr, current: Json, root: Json): boolean {
	switch (expr.kind) {
		case "or":
			return test(expr.left, current, root) || test(expr.right, current, root);
		case "and":
			return test(expr.left, current, root) && test(expr.right, current, root);
		case "not":
			return !test(expr.expr, current, root);
		case "exists":
			return run(expr.path, current, root).length > 0;
		case "compare":
			return compare(expr.op, value(expr.left, current, root), value(expr.right, current, root));
	}
}

/** The values `path` selects in `json`, in document order. Throws JsonPathError for a bad path. */
export function queryJson(json: Json, path: string): Json[] {
	return run(new Parser(path).parse(), json, json);
}
