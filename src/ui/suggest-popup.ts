import type { Suggestion } from "../core/suggest";

/* One list at a time, for whichever field or editor is being typed in. */
let list: HTMLDivElement | undefined;
let items: Suggestion[] = [];
let active = 0;
let pick: ((s: Suggestion) => void) | undefined;
let owner: object | undefined;

/** Shows suggestions under `anchor` for `who`, replacing any shown for another field. */
export function showSuggestions(who: object, next: Suggestion[], anchor: DOMRect, onPick: (s: Suggestion) => void): void {
	if (next.length === 0) return hideSuggestions(who);
	const same = owner === who && items.length === next.length && items.every((s, i) => s.label === next[i]!.label);
	owner = who;
	pick = onPick;
	if (!same) active = 0;
	items = next;
	list ??= create();
	render();
	place(anchor);
}

export function hideSuggestions(who?: object): void {
	if (who !== undefined && who !== owner) return;
	list?.remove();
	list = undefined;
	items = [];
	owner = undefined;
	pick = undefined;
}

export function suggestionsOpenFor(who: object): boolean {
	return owner === who && list !== undefined;
}

/** Arrow keys move, Enter or Tab picks, Escape closes; returns whether the key was used. */
export function suggestionKey(who: object, key: string): boolean {
	if (!suggestionsOpenFor(who)) return false;
	if (key === "ArrowDown" || key === "ArrowUp") {
		active = (active + (key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
		render();
		return true;
	}
	if (key === "Enter" || key === "Tab") {
		const chosen = items[active];
		const run = pick;
		hideSuggestions();
		if (chosen && run) run(chosen);
		return true;
	}
	if (key === "Escape") {
		hideSuggestions();
		return true;
	}
	return false;
}

function create(): HTMLDivElement {
	const el = activeDocument.body.createDiv({ cls: "carbonwire-suggest", attr: { role: "listbox" } });
	// Keeps focus, and the caret, in the field while a row is clicked.
	el.addEventListener("mousedown", (e) => {
		e.preventDefault();
		const row = (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
		const chosen = row ? items[Number(row.dataset.index)] : undefined;
		const run = pick;
		hideSuggestions();
		if (chosen && run) run(chosen);
	});
	return el;
}

function render(): void {
	if (!list) return;
	list.replaceChildren(
		...items.map((s, i) => {
			const row = createDiv({ cls: ["carbonwire-suggest-row", ...(i === active ? ["is-active"] : [])], attr: { role: "option", "aria-selected": String(i === active), "data-index": String(i) } });
			row.createSpan({ cls: "carbonwire-suggest-label", text: s.label });
			if (s.detail !== undefined) row.createSpan({ cls: "carbonwire-suggest-detail", text: s.detail });
			return row;
		}),
	);
	list.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
}

function place(anchor: DOMRect): void {
	if (!list) return;
	const { width, height } = list.getBoundingClientRect();
	const below = anchor.bottom + 2 + height <= activeWindow.innerHeight || anchor.top < height;
	list.style.left = `${Math.max(4, Math.min(anchor.left, activeWindow.innerWidth - width - 4))}px`;
	list.style.top = `${below ? anchor.bottom + 2 : anchor.top - height - 2}px`;
}
