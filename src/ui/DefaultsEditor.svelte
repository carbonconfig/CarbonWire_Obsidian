<script lang="ts">
	import { onDestroy, untrack } from "svelte";
	import type { Auth, HttpRequestHeader, RequestDefaults, Variable } from "../core/model";
	import { variableValue, withValue } from "../core/variables";
	import AuthEditor from "./AuthEditor.svelte";
	import KeyValueTable from "./KeyValueTable.svelte";
	import { createAutosave } from "./autosave";
	import type { LevelSettings } from "../core/inheritance";
	import { renderMarkdown } from "./markdown";
	import RequestSettings from "./RequestSettings.svelte";

	type Doc = { info?: { name?: string }; request?: RequestDefaults; docs?: string | { content: string; type?: string } | null };

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
	/* Docs open first when there are some. */
	const docsText = (docs: Doc["docs"]) => (typeof docs === "string" ? docs : (docs?.content ?? ""));
	let tab = $state<"docs" | "variables" | "headers" | "auth" | "settings">(docsText(untrack(() => initial.docs)).trim() ? "docs" : "variables");
	let editingDocs = $state(false);
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

	function setSettings(next: LevelSettings) {
		const settings = { ...defaults.settings };
		if (Object.keys(next).length === 0) delete settings.http;
		else settings.http = next;
		if (Object.keys(settings).length === 0) delete defaults.settings;
		else defaults.settings = settings;
		autosave.schedule();
	}

	/** Keeps the form the file used: a string, or an object with `content`. */
	function setDocs(text: string) {
		if (doc.docs && typeof doc.docs === "object") doc.docs = { ...doc.docs, content: text };
		else if (text) doc.docs = text;
		else delete doc.docs;
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
			? "Variables, headers, auth and settings here apply to every request in the collection."
			: "Variables, headers, auth and settings here apply to every request in this folder and override the collection's."}
	</p>
	<div class="carbonwire-tabs">
		<button class:is-active={tab === "docs"} onclick={() => (tab = "docs")}>Docs</button>
		<button class:is-active={tab === "variables"} onclick={() => (tab = "variables")}>Variables</button>
		<button class:is-active={tab === "headers"} onclick={() => (tab = "headers")}>Headers</button>
		<button class:is-active={tab === "auth"} onclick={() => (tab = "auth")}>Auth</button>
		<button class:is-active={tab === "settings"} onclick={() => (tab = "settings")}>Settings</button>
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
		{:else if tab === "auth"}
			<AuthEditor auth={defaults.auth} onchange={setAuth} canInherit={kind === "folder"} />
		{:else if tab === "settings"}
			<RequestSettings settings={defaults.settings?.http as LevelSettings | undefined} onchange={setSettings} level={kind} />
		{:else}
			{@const text = docsText(doc.docs)}
			<div class="carbonwire-docs-bar">
				<span class="carbonwire-muted">Markdown, kept in the {kind}'s file.</span>
				<span class="carbonwire-spacer"></span>
				<button onclick={() => (editingDocs = !editingDocs)}>{editingDocs ? "Done" : "Edit"}</button>
			</div>
			{#if editingDocs}
				<textarea class="carbonwire-docs-source" spellcheck="true" aria-label="Docs" value={text} oninput={(e) => setDocs(e.currentTarget.value)}></textarea>
			{:else if text.trim()}
				<!-- renderMarkdown escapes the text first, so docs can't add markup or scripts. -->
				<div class="carbonwire-docs">{@html renderMarkdown(text)}</div>
			{:else}
				<p class="carbonwire-muted">No docs yet. Select Edit to describe this {kind}: what it's for, how to authenticate, links to the API's own docs.</p>
			{/if}
		{/if}
	</div>
</div>
