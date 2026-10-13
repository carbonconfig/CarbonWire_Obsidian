<script lang="ts" generics="Row extends { name: string; value?: unknown; disabled?: boolean; type?: string }">
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
</script>

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
		<button class="carbonwire-kv-add" onclick={() => onchange([...rows, create()])}>
			<span use:icon={"plus"}></span> Add
		</button>
	{/if}
</div>

