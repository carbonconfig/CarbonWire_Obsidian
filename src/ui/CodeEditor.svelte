<script lang="ts">
	import { onMount } from "svelte";
	import { createCodeEditor, type CodeEditorHandle, type CodeLanguage } from "./codemirror";

	let {
		value,
		language = "text",
		readOnly = false,
		variables,
		wrap = true,
		onchange,
	}: {
		value: string;
		language?: CodeLanguage;
		readOnly?: boolean;
		/** Defined variable names; {{references}} are highlighted against them. */
		variables?: ReadonlySet<string>;
		wrap?: boolean;
		onchange?: (value: string) => void;
	} = $props();

	let host: HTMLDivElement;
	let editor: CodeEditorHandle | undefined;
	// The last text the editor holds, so prop updates that echo our own edits don't reset the cursor.
	let current = "";

	onMount(() => {
		current = value;
		editor = createCodeEditor(host, {
			doc: value,
			language,
			readOnly,
			wrap,
			onChange: (doc) => {
				current = doc;
				onchange?.(doc);
			},
		});
		editor.setVariables(variables);
		return () => editor?.destroy();
	});

	$effect(() => {
		if (editor && value !== current) {
			current = value;
			editor.setDoc(value);
		}
	});

	$effect(() => {
		editor?.setLanguage(language);
	});

	$effect(() => {
		editor?.setVariables(variables);
	});

	$effect(() => {
		editor?.setWrap(wrap);
	});

	export function openSearch() {
		editor?.openSearch();
	}
</script>

<div class="carbonwire-code-editor" bind:this={host}></div>
