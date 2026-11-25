import { getContext, setContext } from "svelte";
import { isDynamicVariable, type VariableInfo } from "../core/variables";

const KEY = Symbol("carbonwire-variables");

/** The variables in scope for the current request and environment; undefined while loading. */
export interface VariablesContext {
	readonly names: ReadonlySet<string> | undefined;
	/** Each defined variable's value and where it's set, for hovers. */
	readonly info: ReadonlyMap<string, VariableInfo> | undefined;
	/** The active environment's name, where Ctrl+Click adds a variable that isn't set. */
	readonly environment: string | undefined;
	/** Opens where the variable is set, or adds it to the active environment. */
	edit(name: string): void;
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
