<script lang="ts">
	import { onDestroy, untrack } from "svelte";
	import type { Environment, SecretVariable, Variable } from "../core/model";
	import { variableValue, withValue } from "../core/variables";
	import { icon } from "./actions";
	import { createAutosave } from "./autosave";
	import ColorSwatches from "./ColorSwatches.svelte";

	type Row = Variable | SecretVariable;

	let {
		initial,
		onRename,
		getSecret,
		setSecret,
		onSave,
	}: {
		initial: Environment;
		/** Renames the environment file; resolves to the name used, or undefined if it failed. */
		onRename?: (name: string) => Promise<string | undefined>;
		getSecret: (name: string) => string | null;
		setSecret: (name: string, value: string) => void;
		onSave: (env: Environment) => Promise<void>;
	} = $props();

	let env = $state(structuredClone(untrack(() => initial)));
	const rows = $derived(env.variables ?? []);
	const autosave = createAutosave(() => onSave($state.snapshot(env) as Environment));

	onDestroy(() => void autosave.flush());

	const isSecret = (row: Row): row is SecretVariable => "secret" in row && row.secret;

	async function renameEnvironment(input: HTMLInputElement) {
		const next = input.value.trim();
		if (!onRename || !next || next === env.name) {
			input.value = env.name;
			return;
		}
		const renamed = await onRename(next);
		input.value = renamed ?? env.name;
	}

	function update(i: number, next: Row) {
		env.variables = rows.map((r, j) => (j === i ? next : r));
		autosave.schedule();
	}

	function rename(i: number, row: Row, name: string) {
		// Secret values are keyed by name, so they move with the variable.
		if (isSecret(row) && row.name) setSecret(name, getSecret(row.name) ?? "");
		update(i, { ...row, name });
	}

	function toggleSecret(i: number, row: Row, secret: boolean) {
		if (secret && !isSecret(row)) {
			setSecret(row.name, variableValue(row) ?? "");
			update(i, { secret: true, name: row.name, ...(row.disabled ? { disabled: true } : {}) });
		} else if (!secret && isSecret(row)) {
			update(i, { name: row.name ?? "", value: row.name ? (getSecret(row.name) ?? "") : "", ...(row.disabled ? { disabled: true } : {}) });
		}
	}

	function add() {
		env.variables = [...rows, { name: "", value: "" }];
		autosave.schedule();
	}

	function remove(i: number) {
		env.variables = rows.filter((_, j) => j !== i);
		autosave.schedule();
	}
</script>

<div class="carbonwire-settings">
	<div class="carbonwire-titlebar">
		{#if onRename}
			<input
				class="carbonwire-title-input"
				aria-label="Environment name"
				spellcheck="false"
				value={env.name}
				onkeydown={(e) => {
					if (e.key === "Enter") e.currentTarget.blur();
					else if (e.key === "Escape") {
						e.currentTarget.value = env.name;
						e.currentTarget.blur();
					}
				}}
				onblur={(e) => void renameEnvironment(e.currentTarget)}
			/>
		{:else}
			<span class="carbonwire-title-input">{env.name}</span>
		{/if}
		<span class="carbonwire-muted">environment</span>
		<span class="carbonwire-spacer"></span>
		<ColorSwatches
			value={env.color}
			onchange={(color) => {
				env.color = color;
				autosave.schedule();
			}}
		/>
	</div>
	<p class="carbonwire-muted">
		When active, these variables apply to every collection and override collection variables. Folder and request variables override them.
		Secret values are stored in Obsidian's secret storage on this device and never written to the vault.
	</p>
	<div class="carbonwire-kv">
		{#each rows as row, i (i)}
			{@const secret = isSecret(row)}
			<div class="carbonwire-kv-row" class:is-disabled={row.disabled}>
				<input type="checkbox" aria-label="Enabled" checked={!row.disabled} onchange={(e) => update(i, { ...row, disabled: !e.currentTarget.checked || undefined })} />
				<input type="text" class="carbonwire-kv-name" placeholder="Name" spellcheck="false" value={row.name ?? ""} oninput={(e) => rename(i, row, e.currentTarget.value)} />
				{#if secret}
					<input
						type="password"
						class="carbonwire-kv-value"
						placeholder="Secret value"
						value={row.name ? (getSecret(row.name) ?? "") : ""}
						oninput={(e) => row.name && setSecret(row.name, e.currentTarget.value)}
					/>
				{:else}
					<input type="text" class="carbonwire-kv-value" placeholder="Value" spellcheck="false" value={variableValue(row) ?? ""} oninput={(e) => update(i, withValue(row, e.currentTarget.value))} />
				{/if}
				<button class="clickable-icon" class:is-active={secret} aria-label={secret ? "Stop keeping secret" : "Keep secret"} onclick={() => toggleSecret(i, row, !secret)} use:icon={secret ? "lock" : "lock-open"}></button>
				<button class="clickable-icon" aria-label="Remove" onclick={() => remove(i)} use:icon={"x"}></button>
			</div>
		{/each}
		<button class="carbonwire-kv-add" onclick={add}><span use:icon={"plus"}></span> Add</button>
	</div>
</div>
