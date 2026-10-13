<script lang="ts">
	import { tick } from "svelte";
	import { templateSegments } from "../core/variables";
	import { isDefined, useVariables } from "./variables-context";

	let {
		value,
		placeholder = "",
		class: className = "",
		oninput,
		onpaste,
		onenter,
	}: {
		value: string;
		placeholder?: string;
		class?: string;
		oninput: (value: string) => void;
		onpaste?: (e: ClipboardEvent) => void;
		onenter: () => void;
	} = $props();

	const variables = useVariables();
	let area: HTMLTextAreaElement;
	let mirror = $state<HTMLDivElement>();
	let expanded = $state(false);

	const segments = $derived(templateSegments(value));
	const highlight = $derived(variables?.names !== undefined && segments.some((s) => s.variable !== undefined));

	/* Every metric that moves glyphs, so the coloured mirror lines up with the text area's text. */
	const METRICS = [
		"fontFamily",
		"fontSize",
		"fontWeight",
		"fontStyle",
		"letterSpacing",
		"wordSpacing",
		"lineHeight",
		"paddingTop",
		"paddingRight",
		"paddingBottom",
		"paddingLeft",
		"borderTopWidth",
		"borderRightWidth",
		"borderBottomWidth",
		"borderLeftWidth",
	] as const;

	function sync() {
		if (!mirror) return;
		const cs = getComputedStyle(area);
		for (const prop of METRICS) mirror.style[prop] = cs[prop];
		mirror.style.height = `${area.offsetHeight}px`;
		mirror.scrollLeft = area.scrollLeft;
		mirror.scrollTop = area.scrollTop;
	}

	/** Grows the text area to its content while focused; one line otherwise. */
	function fit() {
		area.style.height = "";
		if (expanded) area.style.height = `${area.scrollHeight + area.offsetHeight - area.clientHeight}px`;
		sync();
	}

	export function focus() {
		area.focus();
		area.setSelectionRange(area.value.length, area.value.length);
	}

	async function setExpanded(next: boolean) {
		expanded = next;
		await tick();
		if (!next) area.scrollLeft = 0;
		fit();
	}

	$effect(() => {
		void value;
		void highlight;
		void tick().then(fit);
	});
</script>

<div class="carbonwire-url-input {className}" class:is-expanded={expanded} class:is-highlighting={highlight}>
	<div class="carbonwire-url-field">
		<textarea
			bind:this={area}
			rows="1"
			spellcheck="false"
			wrap={expanded ? "soft" : "off"}
			aria-label="URL"
			{placeholder}
			{value}
			oninput={(e) => {
				// A URL is one line, even if a pasted value had line breaks.
				const text = e.currentTarget.value.replace(/[\r\n]+/g, "");
				if (text !== e.currentTarget.value) e.currentTarget.value = text;
				oninput(text);
			}}
			{onpaste}
			onkeydown={(e) => {
				if (e.key === "Enter" && !e.isComposing) {
					e.preventDefault();
					onenter();
				} else if (e.key === "Escape") {
					area.blur();
				}
			}}
			onscroll={sync}
			onfocus={() => void setExpanded(true)}
			onblur={() => void setExpanded(false)}
		></textarea>
		{#if highlight && variables?.names}
			{@const names = variables.names}
			<div class="carbonwire-url-mirror" bind:this={mirror} aria-hidden="true">{#each segments as s, i (i)}{#if s.variable !== undefined}<mark class={isDefined(names, s.variable) ? "is-defined" : "is-undefined"}>{s.text}</mark>{:else}{s.text}{/if}{/each}</div>
		{/if}
	</div>
</div>
