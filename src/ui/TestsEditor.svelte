<script lang="ts">
	import type { Action, ActionSetVariable, ActionVariableScope } from "@opencollection/types/common/actions";
	import type { Assertion } from "@opencollection/types/common/assertions";
	import { OPERATORS } from "../core/after-response";
	import { icon } from "./actions";
	import VarInput from "./VarInput.svelte";

	let {
		assertions,
		actions,
		onchange,
	}: {
		assertions: readonly Assertion[];
		actions: readonly Action[];
		onchange: (assertions: Assertion[], actions: Action[]) => void;
	} = $props();

	const SCOPES: [ActionVariableScope, string][] = [
		["runtime", "Until restart"],
		["environment", "Active environment"],
		["collection", "Collection"],
		["folder", "Folder"],
		["request", "This request"],
	];
	const takesValue = (operator: string) => OPERATORS.find((o) => o.id === operator)?.value ?? true;

	/* Actions of other kinds, which OpenCollection may add, are kept as they are. */
	const sets = $derived(actions.filter((a): a is ActionSetVariable => a.type === "set-variable"));
	const others = $derived(actions.filter((a) => a.type !== "set-variable"));

	function setChecks(next: Assertion[]) {
		onchange(next, [...actions]);
	}

	function setSets(next: ActionSetVariable[]) {
		onchange([...assertions], [...next, ...others]);
	}

	function patchCheck(i: number, change: Partial<Assertion>) {
		setChecks(assertions.map((a, j) => (j === i ? withoutUndefined({ ...a, ...change }) : a)));
	}

	function patchSet(i: number, change: { name?: string; scope?: ActionVariableScope; expression?: string; disabled?: boolean }) {
		setSets(
			sets.map((a, j) => {
				if (j !== i) return a;
				const next: ActionSetVariable = {
					...a,
					selector: { ...a.selector, method: "jsonq", expression: change.expression ?? a.selector.expression },
					variable: { name: change.name ?? a.variable.name, scope: change.scope ?? a.variable.scope },
				};
				if ("disabled" in change) next.disabled = change.disabled;
				return withoutUndefined(next);
			}),
		);
	}

	function withoutUndefined<T extends object>(value: T): T {
		return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
	}
</script>

<div class="carbonwire-tests-editor">
	<h4>Check the response</h4>
	<div class="carbonwire-kv">
		{#each assertions as check, i (i)}
			<div class="carbonwire-kv-row carbonwire-test-row" class:is-disabled={check.disabled}>
				<input type="checkbox" aria-label="Enabled" checked={!check.disabled} onchange={(e) => patchCheck(i, { disabled: !e.currentTarget.checked || undefined })} />
				<input type="text" class="carbonwire-test-expression" aria-label="What to check" placeholder="res.status or $.id" spellcheck="false" value={check.expression} oninput={(e) => patchCheck(i, { expression: e.currentTarget.value })} />
				<select class="dropdown" aria-label="Operator" value={check.operator} onchange={(e) => patchCheck(i, { operator: e.currentTarget.value, value: takesValue(e.currentTarget.value) ? (check.value ?? "") : undefined })}>
					{#each OPERATORS as op (op.id)}<option value={op.id}>{op.label}</option>{/each}
					{#if !OPERATORS.some((o) => o.id === check.operator)}<option value={check.operator}>{check.operator}</option>{/if}
				</select>
				{#if takesValue(check.operator)}
					<VarInput class="carbonwire-test-value" aria-label="Expected value" placeholder="Value" value={check.value ?? ""} oninput={(value) => patchCheck(i, { value })} />
				{:else}
					<span class="carbonwire-test-value"></span>
				{/if}
				<button class="clickable-icon" aria-label="Remove" onclick={() => setChecks(assertions.filter((_, j) => j !== i))} use:icon={"x"}></button>
			</div>
		{/each}
		<div class="carbonwire-kv-actions">
			<button class="carbonwire-kv-add" onclick={() => setChecks([...assertions, { expression: "res.status", operator: "eq", value: "200" }])}>
				<span use:icon={"plus"}></span> Add check
			</button>
		</div>
	</div>

	<h4>Save into variables</h4>
	<div class="carbonwire-kv">
		{#each sets as set, i (i)}
			<div class="carbonwire-kv-row carbonwire-test-row" class:is-disabled={set.disabled}>
				<input type="checkbox" aria-label="Enabled" checked={!set.disabled} onchange={(e) => patchSet(i, { disabled: !e.currentTarget.checked || undefined })} />
				<input type="text" class="carbonwire-test-name" aria-label="Variable" placeholder="Variable" spellcheck="false" value={set.variable.name} oninput={(e) => patchSet(i, { name: e.currentTarget.value })} />
				<select class="dropdown" aria-label="Keep it in" value={set.variable.scope} onchange={(e) => patchSet(i, { scope: e.currentTarget.value as ActionVariableScope })}>
					{#each SCOPES as [id, label] (id)}<option value={id}>{label}</option>{/each}
				</select>
				<input type="text" class="carbonwire-test-expression" aria-label="Taken from" placeholder="$.token" spellcheck="false" value={set.selector.expression} oninput={(e) => patchSet(i, { expression: e.currentTarget.value })} />
				<button class="clickable-icon" aria-label="Remove" onclick={() => setSets(sets.filter((_, j) => j !== i))} use:icon={"x"}></button>
			</div>
		{/each}
		<div class="carbonwire-kv-actions">
			<button
				class="carbonwire-kv-add"
				onclick={() => setSets([...sets, { type: "set-variable", phase: "after-response", selector: { expression: "", method: "jsonq" }, variable: { name: "", scope: "runtime" } }])}
			>
				<span use:icon={"plus"}></span> Add variable
			</button>
		</div>
	</div>

	<p class="carbonwire-muted">
		Point at a value with a JSONPath such as <code>$.items[0].id</code>, or <code>res.status</code>, <code>res.headers.content-type</code>, <code>res.body.token</code> or
		<code>res.responseTime</code>. Checks and variables run after each send; results are in the response's Tests tab. Variables kept until restart are on this device only; the
		others are written to the environment, collection, folder or request file. You can also right-click a value in the JSON tree to save it as a variable.
	</p>
</div>
