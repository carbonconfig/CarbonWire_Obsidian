import type { Environment, SecretVariable, Variable } from "./model";

export type Scope = ReadonlyMap<string, string>;
export type SecretLookup = (name: string) => string | null;

export interface ScopeLayers {
	collection?: readonly Variable[];
	/** The active environment, already resolved with {@link resolveEnvironment}. */
	environment?: readonly Variable[];
	/** Outermost folder first. */
	folders?: readonly (readonly Variable[] | undefined)[];
	request?: readonly Variable[];
	runtime?: ReadonlyMap<string, string>;
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;
const MAX_DEPTH = 10;

export function variableValue(variable: Variable): string | undefined {
	const value = variable.value;
	if (value === undefined) return undefined;
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		const variant = value.find((v) => v.selected) ?? value[0];
		if (!variant) return undefined;
		return typeof variant.value === "string" ? variant.value : variant.value.data;
	}
	return value.data;
}

function isSecret(v: Variable | SecretVariable): v is SecretVariable {
	return "secret" in v && v.secret;
}

function addAll(scope: Map<string, string>, vars: readonly Variable[] | undefined): void {
	if (!vars) return;
	for (const v of vars) {
		if (v.disabled) continue;
		const value = variableValue(v);
		if (value !== undefined) scope.set(v.name, value);
	}
}

/** Turns an environment into plain variables, looking secret values up by name. */
export function resolveEnvironment(env: Environment | undefined, secrets?: SecretLookup): Variable[] {
	const out: Variable[] = [];
	for (const v of env?.variables ?? []) {
		if (v.disabled || !v.name) continue;
		if (isSecret(v)) {
			const value = secrets?.(v.name);
			if (value != null) out.push({ name: v.name, value });
		} else {
			out.push(v);
		}
	}
	return out;
}

/** Later layers override earlier ones: collection < environment < folders < request < runtime. */
export function buildScope(layers: ScopeLayers): Scope {
	const scope = new Map<string, string>();
	addAll(scope, layers.collection);
	addAll(scope, layers.environment);
	for (const folder of layers.folders ?? []) addAll(scope, folder);
	addAll(scope, layers.request);
	if (layers.runtime) for (const [k, v] of layers.runtime) scope.set(k, v);
	return scope;
}

const dynamic: Record<string, () => string> = {
	$guid: () => crypto.randomUUID(),
	$uuid: () => crypto.randomUUID(),
	$randomUUID: () => crypto.randomUUID(),
	$timestamp: () => Math.floor(Date.now() / 1000).toString(),
	$isoTimestamp: () => new Date().toISOString(),
	$randomInt: () => Math.floor(Math.random() * 1001).toString(),
};

/** True for names that resolve without being defined, such as {{$guid}}. */
export function isDynamicVariable(name: string): boolean {
	return Object.hasOwn(dynamic, name);
}

/** A piece of text that is either literal or a {{variable}} reference. */
export type TemplateSegment = { text: string; variable?: string };

/** Splits text into literal runs and {{variable}} references, for highlighting. */
export function templateSegments(text: string): TemplateSegment[] {
	const out: TemplateSegment[] = [];
	let last = 0;
	for (const m of text.matchAll(PLACEHOLDER)) {
		if (m.index > last) out.push({ text: text.slice(last, m.index) });
		out.push({ text: m[0], variable: m[1]! });
		last = m.index + m[0].length;
	}
	if (last < text.length) out.push({ text: text.slice(last) });
	return out;
}

/** Unknown placeholders are left untouched so the UI can flag them. */
export function interpolate(input: string, scope: Scope): string {
	if (!input.includes("{{")) return input;
	let current = input;
	for (let depth = 0; depth < MAX_DEPTH; depth++) {
		let changed = false;
		const next = current.replace(PLACEHOLDER, (match, name: string) => {
			const value = scope.get(name) ?? dynamic[name]?.();
			if (value === undefined) return match;
			changed = true;
			return value;
		});
		if (!changed || !next.includes("{{")) return next;
		current = next;
	}
	return current;
}

export function unresolvedNames(input: string, scope: Scope): string[] {
	const names = new Set<string>();
	for (const [, name] of interpolate(input, scope).matchAll(PLACEHOLDER)) {
		if (name !== undefined) names.add(name);
	}
	return [...names];
}

/** Interpolates every string inside a plain JSON-like value, e.g. an auth config. */
export function interpolateDeep<T>(value: T, scope: Scope): T {
	if (typeof value === "string") return interpolate(value, scope) as T;
	if (Array.isArray(value)) return value.map((v: unknown) => interpolateDeep(v, scope)) as T;
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = interpolateDeep(v, scope);
		return out as T;
	}
	return value;
}

/** Replaces the displayed value while keeping a typed value's type or the selected variant. */
export function withValue(variable: Variable, text: string): Variable {
	const value = variable.value;
	if (Array.isArray(value)) {
		const i = Math.max(0, value.findIndex((v) => v.selected));
		const next = value.map((v, j) => (j === i ? { ...v, value: typeof v.value === "string" ? text : { ...v.value, data: text } } : v));
		return { ...variable, value: next };
	}
	if (value !== undefined && typeof value === "object") return { ...variable, value: { ...value, data: text } };
	return { ...variable, value: text };
}
