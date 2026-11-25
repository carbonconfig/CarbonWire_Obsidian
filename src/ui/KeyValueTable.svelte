<script lang="ts" generics="Row extends { name: string; value?: unknown; disabled?: boolean; type?: string }">
	import { fromBulkText, toBulkText } from "../core/bulk-edit";
	import type { Suggestion } from "../core/suggest";
	import { icon } from "./actions";
	import VarInput from "./VarInput.svelte";

	let {
		rows,
		onchange,
		create,
		fileToggle = false,
		namePlaceholder = "Name",
		valuePlaceholder = "Value",
		fixedNames = false,
		toggleable = true,
		displayValue,
		editValue,
		suggestName,
		suggestValue,
	}: {
		rows: readonly Row[];
		onchange: (rows: Row[]) => void;
		create?: () => Row;
		fileToggle?: boolean;
		namePlaceholder?: string;
		valuePlaceholder?: string;
		fixedNames?: boolean;
		/** Rows that can't be disabled, such as path params, keep the checkbox column empty. */
		toggleable?: boolean;
		/** For rows whose value isn't a plain string, such as typed variables. */
		displayValue?: (row: Row) => string;
		editValue?: (row: Row, text: string) => Row;
		/** Suggestions while typing a name, such as common headers. */
		suggestName?: (text: string) => Suggestion[];
		/** Suggestions while typing a row's value, such as a header's usual values. */
		suggestValue?: (name: string, text: string) => Suggestion[];
	} = $props();

	function patch(i: number, change: Partial<Row>) {
		onchange(rows.map((r, j) => (j === i ? { ...r, ...change } : r)));
	}

	function remove(i: number) {
		onchange(rows.filter((_, j) => j !== i));
	}

	function display(row: Row): string {
		if (displayValue) return displayValue(row);
		return Array.isArray(row.value) ? row.value.join(", ") : typeof row.value === "string" ? row.value : "";
	}

	function setValue(i: number, text: string) {
		onchange(rows.map((r, j) => (j !== i ? r : editValue ? editValue(r, text) : { ...r, value: text })));
	}

	/* Bulk edit: the rows as `name: value` lines. The text is kept while editing, so the caret stays put. */
	let bulk = $state<string | undefined>();
	const canBulk = $derived(create !== undefined && !fixedNames);

	function startBulk() {
		bulk = toBulkText(rows.map((r) => ({ name: r.name, value: display(r), disabled: r.disabled })));
	}

	/** Rows keep what the text can't hold, such as a field's file type, when their name stays the same. */
	function applyBulk(text: string) {
		bulk = text;
		const pool = [...rows];
		const next = fromBulkText(text).map((line) => {
			const at = pool.findIndex((r) => r.name === line.name);
			const base = at >= 0 ? pool.splice(at, 1)[0]! : create!();
			const row = { ...base, name: line.name, disabled: (toggleable && line.disabled) || undefined };
			if (row.disabled === undefined) delete row.disabled;
			return editValue ? editValue(row, line.value) : { ...row, value: line.value };
		});
		onchange(next);
	}
</script>

{#if bulk !== undefined}
	<div class="carbonwire-kv">
		<textarea
			class="carbonwire-kv-bulk"
			spellcheck="false"
			aria-label="Rows as name: value lines"
			placeholder={`name: value\n// a disabled row: value`}
			rows={Math.min(20, Math.max(4, bulk.split("\n").length + 1))}
			value={bulk}
			oninput={(e) => applyBulk(e.currentTarget.value)}
		></textarea>
		<div class="carbonwire-kv-actions">
			<span class="carbonwire-muted">One <code>name: value</code> per line; <code>//</code> in front disables a row.</span>
			<span class="carbonwire-spacer"></span>
			<button onclick={() => (bulk = undefined)}>Done</button>
		</div>
	</div>
{:else}
<div class="carbonwire-kv">
	{#each rows as row, i (i)}
		<div class="carbonwire-kv-row" class:is-disabled={row.disabled}>
			{#if toggleable}
				<input
					type="checkbox"
					checked={!row.disabled}
					aria-label="Enabled"
					onchange={(e) => patch(i, { disabled: !e.currentTarget.checked || undefined } as Partial<Row>)}
				/>
			{:else}
				<input type="checkbox" class="carbonwire-kv-toggle-spacer" disabled tabindex="-1" aria-hidden="true" />
			{/if}
			<VarInput
				class="carbonwire-kv-name"
				suggest={suggestName}
				placeholder={namePlaceholder}
				value={row.name}
				readonly={fixedNames}
				oninput={(name) => patch(i, { name } as Partial<Row>)}
			/>
			{#if fileToggle}
				<select
					class="dropdown carbonwire-kv-type"
					value={row.type ?? "text"}
					onchange={(e) => patch(i, { type: e.currentTarget.value } as Partial<Row>)}
				>
					<option value="text">Text</option>
					<option value="file">File</option>
				</select>
			{/if}
			<VarInput
				class="carbonwire-kv-value"
				suggest={suggestValue && ((text) => suggestValue(row.name, text))}
				placeholder={fileToggle && row.type === "file" ? "Path relative to the collection" : valuePlaceholder}
				value={display(row)}
				oninput={(text) => setValue(i, text)}
			/>
			{#if !fixedNames}
				<button class="clickable-icon" aria-label="Remove" onclick={() => remove(i)} use:icon={"x"}></button>
			{/if}
		</div>
	{/each}
	{#if create}
		<div class="carbonwire-kv-actions">
			<button class="carbonwire-kv-add" onclick={() => onchange([...rows, create()])}>
				<span use:icon={"plus"}></span> Add
			</button>
			{#if canBulk}
				<button class="carbonwire-kv-bulk-toggle" onclick={startBulk}>Bulk edit</button>
			{/if}
		</div>
	{/if}
</div>
{/if}

