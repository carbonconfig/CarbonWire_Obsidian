<script lang="ts">
	import { onDestroy, untrack } from "svelte";
	import type { Auth, HttpRequestHeader, RequestDefaults, Variable } from "../core/model";
	import { variableValue, withValue } from "../core/variables";
	import AuthEditor from "./AuthEditor.svelte";
	import KeyValueTable from "./KeyValueTable.svelte";
	import { createAutosave } from "./autosave";

	type Doc = { info?: { name?: string }; request?: RequestDefaults };

	let {
		initial,
		kind,
		onSave,
	}: {
		initial: Doc;
		kind: "collection" | "folder";
		onSave: (doc: Doc) => Promise<void>;
	} = $props();

	const loaded = structuredClone(untrack(() => initial));
	loaded.request ??= {};
	let doc = $state(loaded);
	let tab = $state<"variables" | "headers" | "auth">("variables");
	const defaults = $derived(doc.request!);
	const autosave = createAutosave(() => onSave($state.snapshot(doc) as Doc));

	onDestroy(() => void autosave.flush());

	function setVariables(rows: Variable[]) {
		defaults.variables = rows;
		autosave.schedule();
	}

	function setHeaders(rows: HttpRequestHeader[]) {
		defaults.headers = rows;
		autosave.schedule();
	}

	function setAuth(auth: Auth | undefined) {
		if (auth === undefined) delete defaults.auth;
		else defaults.auth = auth;
		autosave.schedule();
	}
</script>

<div class="carbonwire-settings">
	<div class="carbonwire-titlebar">
		<span class="carbonwire-title-input">{doc.info?.name ?? (kind === "collection" ? "Collection" : "Folder")}</span>
		<span class="carbonwire-muted">{kind} settings</span>
	</div>
	<p class="carbonwire-muted">
		{kind === "collection"
			? "Variables, headers and auth here apply to every request in the collection."
			: "Variables, headers and auth here apply to every request in this folder and override the collection's."}
	</p>
	<div class="carbonwire-tabs">
		<button class:is-active={tab === "variables"} onclick={() => (tab = "variables")}>Variables</button>
		<button class:is-active={tab === "headers"} onclick={() => (tab = "headers")}>Headers</button>
		<button class:is-active={tab === "auth"} onclick={() => (tab = "auth")}>Auth</button>
	</div>
	<div class="carbonwire-request-content">
		{#if tab === "variables"}
			<KeyValueTable
				rows={defaults.variables ?? []}
				onchange={setVariables}
				create={(): Variable => ({ name: "", value: "" })}
				displayValue={(v) => variableValue(v) ?? ""}
				editValue={withValue}
			/>
		{:else if tab === "headers"}
			<KeyValueTable rows={defaults.headers ?? []} onchange={setHeaders} create={() => ({ name: "", value: "" })} />
		{:else}
			<AuthEditor auth={defaults.auth} onchange={setAuth} canInherit={kind === "folder"} />
		{/if}
	</div>
</div>
