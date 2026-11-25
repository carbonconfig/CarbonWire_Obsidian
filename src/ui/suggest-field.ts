import { DYNAMIC_NAMES } from "../core/dynamic";
import { suggestVariables, variableQuery, type Suggestion } from "../core/suggest";
import { hideSuggestions, showSuggestions, suggestionKey } from "./suggest-popup";
import type { VariablesContext } from "./variables-context";

export interface SuggestParams {
	/** Variables to suggest after {{; none outside a request tab. */
	context: VariablesContext | undefined;
	/** Suggestions for the whole field, such as header names, when no {{ is being typed. */
	suggest?: (text: string) => Suggestion[];
	/** Sets the field's value, as typing would. */
	apply: (text: string) => void;
}

/** Suggestions while typing in an input or text area: variables after {{, else the field's own. */
export function suggestField(el: HTMLInputElement | HTMLTextAreaElement, params: SuggestParams) {
	const update = () => {
		const text = el.value;
		const caret = el.selectionStart ?? text.length;
		const query = params.context ? variableQuery(text, caret) : undefined;
		let from = 0;
		let to = text.length;
		let items: Suggestion[] = [];
		if (query) {
			items = suggestVariables(query.query, params.context?.info?.values() ?? [], DYNAMIC_NAMES);
			from = query.from;
			to = query.to;
		} else if (params.suggest) {
			items = params.suggest(text);
		}
		showSuggestions(el, items, el.getBoundingClientRect(), (s) => {
			const next = text.slice(0, from) + s.insert + text.slice(to);
			el.value = next;
			params.apply(next);
			const at = from + s.insert.length;
			el.setSelectionRange(at, at);
		});
	};
	// Runs before the field's own key handling, such as Enter sending the request.
	const keydown = (e: Event) => {
		const key = (e as KeyboardEvent).key;
		if (!suggestionKey(el, key)) return;
		e.preventDefault();
		e.stopImmediatePropagation();
	};
	const keyup = (e: Event) => {
		if (["ArrowLeft", "ArrowRight", "Home", "End"].includes((e as KeyboardEvent).key)) update();
	};
	// An empty field shows its suggestions straight away, such as a header's usual values.
	const focus = () => {
		if (el.value === "" && params.suggest) update();
	};
	const blur = () => hideSuggestions(el);
	el.addEventListener("input", update);
	el.addEventListener("keydown", keydown, true);
	el.addEventListener("keyup", keyup);
	el.addEventListener("focus", focus);
	el.addEventListener("blur", blur);
	return {
		update(next: SuggestParams) {
			params = next;
		},
		destroy() {
			hideSuggestions(el);
			el.removeEventListener("input", update);
			el.removeEventListener("keydown", keydown, true);
			el.removeEventListener("keyup", keyup);
			el.removeEventListener("focus", focus);
			el.removeEventListener("blur", blur);
		},
	};
}
