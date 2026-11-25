<script lang="ts">
	import type { FormUrlEncodedEntry } from "@opencollection/types/requests/http";
	import { onDestroy } from "svelte";
	import { checkJson, type JsonProblem } from "../core/json-check";
	import { formatJsonBody } from "../core/json-pretty";
	import type { HttpRequestBody, HttpRequestDetails, MultipartFormEntry } from "../core/model";
	import { icon } from "./actions";
	import CodeEditor from "./CodeEditor.svelte";
	import KeyValueTable from "./KeyValueTable.svelte";
	import VarInput from "./VarInput.svelte";
	import { useVariables } from "./variables-context";

	let { body, onchange }: { body: HttpRequestDetails["body"]; onchange: (body: HttpRequestBody | undefined) => void } = $props();

	const current = $derived(Array.isArray(body) ? (body.find((v) => v.selected) ?? body[0])?.body : body);
	const kind = $derived(current?.type ?? "none");
	let editor = $state<ReturnType<typeof CodeEditor>>();
	const variables = useVariables();

	/* Checked a moment after typing stops; very large bodies aren't checked. */
	const CHECK_DELAY_MS = 300;
	const CHECK_LIMIT = 5_000_000;
	const json = $derived(current?.type === "json" ? current.data : undefined);
	let problem = $state.raw<JsonProblem | undefined>();
	let checked: string | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const text = json;
		clearTimeout(timer);
		if (text === undefined || text.length > CHECK_LIMIT) {
			checked = undefined;
			problem = undefined;
			return;
		}
		// The first check, when the tab opens or the body type changes, doesn't wait.
		const run = () => {
			checked = text;
			problem = checkJson(text);
		};
		if (checked === undefined) run();
		else if (text !== checked) timer = setTimeout(run, CHECK_DELAY_MS);
	});
	onDestroy(() => clearTimeout(timer));

	/** "Line 3, column 12", counted the way the editor's gutter counts. */
	function position(text: string, offset: number): string {
		const before = text.slice(0, offset);
		const line = before.split("\n").length;
		return `Line ${line}, column ${offset - before.lastIndexOf("\n")}`;
	}

	/** Returns false when the body has no text editor to search. */
	export function openSearch(): boolean {
		if (!editor) return false;
		editor.openSearch();
		return true;
	}

	function change(type: string) {
		switch (type) {
			case "none":
				return onchange(undefined);
			case "json":
			case "text":
			case "xml":
			case "sparql":
				return onchange({ type, data: current && "data" in current && typeof current.data === "string" ? current.data : "" });
			case "form-urlencoded":
				return onchange({ type, data: [] });
			case "multipart-form":
				return onchange({ type, data: [] });
			case "file":
				return onchange({ type, data: [{ filePath: "", contentType: "application/octet-stream", selected: true }] });
		}
	}

	/** Lays out the JSON, comments and {{variables}} kept; with a mistake in it, goes to the mistake instead. */
	function format() {
		if (current?.type !== "json" || !current.data.trim()) return;
		const text = current.data;
		const found = checkJson(text);
		if (found) {
			clearTimeout(timer);
			checked = text;
			problem = found;
			editor?.reveal(found.from);
			return;
		}
		const formatted = formatJsonBody(text);
		if (formatted !== text) onchange({ type: "json", data: formatted });
	}
</script>

<div class="carbonwire-body">
	<div class="carbonwire-body-bar">
		<select class="dropdown" value={kind} onchange={(e) => change(e.currentTarget.value)}>
			<option value="none">No body</option>
			<option value="json">JSON</option>
			<option value="text">Text</option>
			<option value="xml">XML</option>
			<option value="form-urlencoded">Form URL-encoded</option>
			<option value="multipart-form">Multipart form</option>
			<option value="file">File</option>
		</select>
		<span class="carbonwire-spacer"></span>
		{#if kind === "json"}
			<button class="clickable-icon" aria-label="Format JSON" onclick={format} use:icon={"wand"}></button>
		{/if}
		{#if kind === "json" || kind === "text" || kind === "xml" || kind === "sparql"}
			<button class="clickable-icon" aria-label="Search body" onclick={() => editor?.openSearch()} use:icon={"search"}></button>
		{/if}
	</div>

	{#if current?.type === "json" || current?.type === "text" || current?.type === "xml" || current?.type === "sparql"}
		{@const raw = current}
		<div class="carbonwire-editor-host">
			<CodeEditor bind:this={editor} value={raw.data} language={raw.type === "json" ? "json" : "text"} variables={variables?.names} problem={raw.type === "json" ? problem : undefined} onchange={(data) => onchange({ type: raw.type, data })} />
		</div>
		{#if raw.type === "json" && problem}
			{@const at = problem.from}
			<button class="carbonwire-json-problem" title="Go to the mistake" onclick={() => editor?.reveal(at)}>
				<span class="carbonwire-json-problem-at">{position(raw.data, at)}</span>
				{problem.message}
			</button>
		{/if}
	{:else if current?.type === "form-urlencoded"}
		<KeyValueTable
			rows={current.data}
			onchange={(rows) => onchange({ type: "form-urlencoded", data: rows as FormUrlEncodedEntry[] })}
			create={() => ({ name: "", value: "" })}
		/>
	{:else if current?.type === "multipart-form"}
		<KeyValueTable
			rows={current.data}
			fileToggle
			onchange={(rows) => onchange({ type: "multipart-form", data: rows as MultipartFormEntry[] })}
			create={(): MultipartFormEntry => ({ name: "", value: "", type: "text" })}
		/>
	{:else if current?.type === "file"}
		{@const file = current.data.find((v) => v.selected) ?? current.data[0]}
		<label class="carbonwire-field">
			<span>File path (relative to the collection)</span>
			<VarInput
				value={file?.filePath ?? ""}
				oninput={(filePath) => onchange({ type: "file", data: [{ filePath, contentType: file?.contentType ?? "application/octet-stream", selected: true }] })}
			/>
		</label>
		<label class="carbonwire-field">
			<span>Content type</span>
			<input
				type="text"
				value={file?.contentType ?? ""}
				oninput={(e) => onchange({ type: "file", data: [{ filePath: file?.filePath ?? "", contentType: e.currentTarget.value, selected: true }] })}
			/>
		</label>
	{:else}
		<p class="carbonwire-muted">This request has no body.</p>
	{/if}
</div>
