import { getContext, setContext } from "svelte";
import { isDynamicVariable } from "../core/variables";

const KEY = Symbol("carbonwire-variables");

/** Defined variable names for the current request and environment; undefined while loading. */
export interface VariablesContext {
	readonly names: ReadonlySet<string> | undefined;
}

export function provideVariables(context: VariablesContext): void {
	setContext(KEY, context);
}

/** Undefined outside a request tab, where nothing is highlighted. */
export function useVariables(): VariablesContext | undefined {
	return getContext<VariablesContext | undefined>(KEY);
}

export function isDefined(names: ReadonlySet<string>, name: string): boolean {
	return names.has(name) || isDynamicVariable(name);
}
