import type { Action, ActionVariableScope } from "@opencollection/types/common/actions";
import type { Assertion } from "@opencollection/types/common/assertions";
import { queryJson } from "./jsonpath";
import type { Header } from "./model";

/* Checks and variables taken from a response, as OpenCollection's assertions and set-variable actions. */

/** A response as checks read it: the body as text and, when it parses, as JSON. */
export interface ReadResponse {
	status: number;
	statusText: string;
	headers: readonly Header[];
	text: string;
	json?: { value: unknown };
	/** Milliseconds, from sending to the last byte. */
	time: number;
}

export function readResponse(response: { status: number; statusText: string; headers: readonly Header[]; body: Uint8Array; timings: { total: number } }): ReadResponse {
	const text = new TextDecoder().decode(response.body);
	let json: ReadResponse["json"];
	try {
		json = { value: JSON.parse(text) };
	} catch {
		json = undefined;
	}
	return { status: response.status, statusText: response.statusText, headers: response.headers, text, json, time: response.timings.total };
}

export type Lookup = { found: true; value: unknown } | { found: false; error?: string };

const EXPRESSION_HELP = "Use a JSONPath such as $.id, or res.status, res.headers.name, res.body.path or res.responseTime.";

/**
 * The value an expression picks out: a JSONPath on the body ($.items[0].id), or Bruno's
 * res.status, res.statusText, res.responseTime, res.headers.name and res.body.path.
 */
export function lookup(res: ReadResponse, expression: string): Lookup {
	const expr = expression.trim();
	if (expr.startsWith("$")) return jsonPath(res, expr);
	const m = /^res(?:ponse)?\.(\w+)(.*)$/.exec(expr);
	if (!m) return { found: false, error: EXPRESSION_HELP };
	const [, part, rest = ""] = m;
	switch (part) {
		case "status":
			return rest ? { found: false, error: EXPRESSION_HELP } : { found: true, value: res.status };
		case "statusText":
			return rest ? { found: false, error: EXPRESSION_HELP } : { found: true, value: res.statusText };
		case "responseTime":
		case "time":
			return rest ? { found: false, error: EXPRESSION_HELP } : { found: true, value: res.time };
		case "headers": {
			const name = /^\.([\w-]+)$/.exec(rest)?.[1] ?? /^\[\s*["']([^"']+)["']\s*\]$/.exec(rest)?.[1];
			if (!rest) return { found: true, value: Object.fromEntries(res.headers.map(([n, v]) => [n.toLowerCase(), v])) };
			if (!name) return { found: false, error: "Name a header, such as res.headers.content-type." };
			const values = res.headers.filter(([n]) => n.toLowerCase() === name.toLowerCase()).map(([, v]) => v);
			return values.length ? { found: true, value: values.join(", ") } : { found: false };
		}
		case "body":
			if (!rest) return { found: true, value: res.json ? res.json.value : res.text };
			return jsonPath(res, `$${rest}`);
		default:
			return { found: false, error: EXPRESSION_HELP };
	}
}

function jsonPath(res: ReadResponse, path: string): Lookup {
	if (!res.json) return { found: false, error: "The response isn't JSON." };
	try {
		const matches = queryJson(res.json.value, path);
		return matches.length > 0 ? { found: true, value: matches[0] } : { found: false };
	} catch (e) {
		return { found: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/** A variable name for a JSONPath, from its last part: token for $.data.token, items for $.items[0]. */
export function nameFromPath(path: string): string {
	const parts = [...path.matchAll(/\.([\w$-]+)|\[\s*['"]([^'"]+)['"]\s*\]/g)].map((m) => m[1] ?? m[2]!);
	return parts.at(-1)?.replace(/[^\w$.-]+/g, "_") ?? "value";
}

/** A value as text: strings as they are, anything else as JSON. */
export function asText(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined) return "undefined";
	return JSON.stringify(value);
}

/** Bruno's operators, in the order the editor lists them; `value` says whether one is needed. */
export const OPERATORS: readonly { id: string; label: string; value: boolean }[] = [
	{ id: "eq", label: "equals", value: true },
	{ id: "neq", label: "doesn't equal", value: true },
	{ id: "gt", label: ">", value: true },
	{ id: "gte", label: "≥", value: true },
	{ id: "lt", label: "<", value: true },
	{ id: "lte", label: "≤", value: true },
	{ id: "contains", label: "contains", value: true },
	{ id: "notContains", label: "doesn't contain", value: true },
	{ id: "in", label: "is one of", value: true },
	{ id: "notIn", label: "is none of", value: true },
	{ id: "startsWith", label: "starts with", value: true },
	{ id: "endsWith", label: "ends with", value: true },
	{ id: "matches", label: "matches", value: true },
	{ id: "notMatches", label: "doesn't match", value: true },
	{ id: "length", label: "has length", value: true },
	{ id: "between", label: "is between", value: true },
	{ id: "isDefined", label: "is set", value: false },
	{ id: "isUndefined", label: "isn't set", value: false },
	{ id: "isNull", label: "is null", value: false },
	{ id: "isEmpty", label: "is empty", value: false },
	{ id: "isNotEmpty", label: "isn't empty", value: false },
	{ id: "isTruthy", label: "is truthy", value: false },
	{ id: "isFalsy", label: "is falsy", value: false },
	{ id: "isNumber", label: "is a number", value: false },
	{ id: "isString", label: "is a string", value: false },
	{ id: "isBoolean", label: "is a boolean", value: false },
	{ id: "isArray", label: "is an array", value: false },
	{ id: "isJson", label: "is an object or array", value: false },
];

const SHOWN = 200;

/** How one check went, with what the response had there. */
export interface CheckResult {
	expression: string;
	operator: string;
	value?: string;
	passed: boolean;
	/** What the expression found, as text, cut short when long; undefined when nothing was there. */
	actual?: string;
	/** Why it couldn't be checked, such as a bad expression. */
	error?: string;
}

/** Runs the enabled checks; `interpolate` fills {{variables}} in expected values. */
export function runChecks(res: ReadResponse, assertions: readonly Assertion[] | undefined, interpolate: (text: string) => string = (t) => t): CheckResult[] {
	return (assertions ?? []).filter((a) => !a.disabled && a.expression.trim()).map((a) => {
		const found = lookup(res, a.expression);
		const expected = a.value === undefined ? undefined : interpolate(a.value);
		const base = { expression: a.expression, operator: a.operator, ...(expected !== undefined ? { value: expected } : {}) };
		if (!found.found && found.error) return { ...base, passed: false, error: found.error };
		const actual = found.found ? asText(found.value) : undefined;
		const shown = actual !== undefined && actual.length > SHOWN ? `${actual.slice(0, SHOWN)}…` : actual;
		try {
			return { ...base, passed: check(a.operator, found, expected ?? ""), ...(shown !== undefined ? { actual: shown } : {}) };
		} catch (e) {
			return { ...base, passed: false, error: e instanceof Error ? e.message : String(e), ...(shown !== undefined ? { actual: shown } : {}) };
		}
	});
}

/** The expected value as JSON when it reads as JSON (200, true, "text", [1, 2]), else as text. */
function parseExpected(raw: string): unknown {
	try {
		return JSON.parse(raw.trim());
	} catch {
		return raw.trim();
	}
}

function equals(actual: unknown, raw: string): boolean {
	const expected = parseExpected(raw);
	if (deepEqual(actual, expected)) return true;
	return (typeof actual !== "object" || actual === null) && String(actual) === raw.trim();
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const ka = Object.keys(a);
	const kb = Object.keys(b);
	return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function list(raw: string): string[] {
	const parsed = parseExpected(raw);
	if (Array.isArray(parsed)) return parsed.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
	return raw.split(",").map((s) => s.trim());
}

function number(value: unknown, what: string): number {
	const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
	if (!Number.isFinite(n)) throw new Error(`${what} isn't a number.`);
	return n;
}

function text(value: unknown): string {
	return typeof value === "string" ? value : asText(value);
}

/** A plain string, unquoted if it was written as a JSON string. */
function expectedText(raw: string): string {
	const parsed = parseExpected(raw);
	return typeof parsed === "string" ? parsed : raw.trim();
}

function regex(raw: string): RegExp {
	const literal = /^\/(.*)\/([a-z]*)$/s.exec(raw.trim());
	return literal ? new RegExp(literal[1]!, literal[2]) : new RegExp(expectedText(raw));
}

function isEmpty(value: unknown): boolean {
	if (value === "" || value === null || value === undefined) return true;
	if (Array.isArray(value)) return value.length === 0;
	return typeof value === "object" && Object.keys(value).length === 0;
}

function check(operator: string, found: Lookup, raw: string): boolean {
	const has = found.found;
	const actual = found.found ? found.value : undefined;
	switch (operator) {
		case "eq":
			return has && equals(actual, raw);
		case "neq":
			return !has || !equals(actual, raw);
		case "gt":
			return has && number(actual, "The value") > number(raw, "The expected value");
		case "gte":
			return has && number(actual, "The value") >= number(raw, "The expected value");
		case "lt":
			return has && number(actual, "The value") < number(raw, "The expected value");
		case "lte":
			return has && number(actual, "The value") <= number(raw, "The expected value");
		case "in":
			return has && list(raw).some((v) => equals(actual, v));
		case "notIn":
			return !has || !list(raw).some((v) => equals(actual, v));
		case "contains":
		case "notContains": {
			const expected = expectedText(raw);
			const yes = has && (Array.isArray(actual) ? actual.some((v) => equals(v, raw)) : text(actual).includes(expected));
			return operator === "contains" ? yes : !yes;
		}
		case "startsWith":
			return has && text(actual).startsWith(expectedText(raw));
		case "endsWith":
			return has && text(actual).endsWith(expectedText(raw));
		case "matches":
			return has && regex(raw).test(text(actual));
		case "notMatches":
			return !has || !regex(raw).test(text(actual));
		case "length": {
			const length = Array.isArray(actual) || typeof actual === "string" ? actual.length : undefined;
			if (length === undefined) return false;
			return length === number(raw, "The expected length");
		}
		case "between": {
			const [low, high] = list(raw);
			if (low === undefined || high === undefined) throw new Error("Write the range as low, high, such as 200, 299.");
			const n = number(actual, "The value");
			return has && n >= number(low, "The low end") && n <= number(high, "The high end");
		}
		case "isDefined":
			return has && actual !== undefined;
		case "isUndefined":
			return !has || actual === undefined;
		case "isNull":
			return has && actual === null;
		case "isEmpty":
			return has && isEmpty(actual);
		case "isNotEmpty":
			return has && !isEmpty(actual);
		case "isTruthy":
			return has && Boolean(actual);
		case "isFalsy":
			return !has || !actual;
		case "isNumber":
			return has && typeof actual === "number";
		case "isString":
			return has && typeof actual === "string";
		case "isBoolean":
			return has && typeof actual === "boolean";
		case "isArray":
			return has && Array.isArray(actual);
		case "isJson":
			return has && typeof actual === "object" && actual !== null;
		default:
			throw new Error(`${operator} isn't an operator CarbonWire knows.`);
	}
}

/** What a send's checks and variables came to, shown in the response's Tests tab. */
export interface AfterResponse {
	checks: CheckResult[];
	variables: VariableResult[];
}

/** A variable an action takes from the response, or why it couldn't. */
export interface VariableResult {
	name: string;
	scope: ActionVariableScope;
	expression: string;
	value?: string;
	error?: string;
}

/** Runs the enabled set-variable actions that come after the response. */
export function runActions(res: ReadResponse, actions: readonly Action[] | undefined): VariableResult[] {
	return (actions ?? [])
		.filter((a) => a.type === "set-variable" && !a.disabled && (a.phase ?? "after-response") === "after-response" && a.variable?.name?.trim())
		.map((a) => {
			const base = { name: a.variable.name.trim(), scope: a.variable.scope ?? "runtime", expression: a.selector?.expression ?? "" };
			const found = lookup(res, base.expression);
			if (!found.found) return { ...base, error: found.error ?? `Nothing in the response at ${base.expression}.` };
			return { ...base, value: asText(found.value) };
		});
}
