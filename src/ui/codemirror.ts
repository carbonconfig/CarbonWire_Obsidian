import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import {
	closeSearchPanel,
	findNext,
	findPrevious,
	getSearchQuery,
	highlightSelectionMatches,
	openSearchPanel,
	search,
	SearchQuery,
	searchKeymap,
	setSearchQuery,
} from "@codemirror/search";
import { Compartment, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, keymap, lineNumbers, MatchDecorator, ViewPlugin, type DecorationSet, type Panel, type ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { setIcon } from "obsidian";
import { isDynamicVariable } from "../core/variables";

export type CodeLanguage = "json" | "text";

/** Above this size, syntax highlighting is skipped so huge responses stay responsive. */
const HIGHLIGHT_LIMIT = 10_000_000;

/** Token colours come from Obsidian's code-block theme variables, so every theme applies. */
const highlightStyle = HighlightStyle.define([
	{ tag: tags.propertyName, color: "var(--code-property, var(--code-function))" },
	{ tag: tags.string, color: "var(--code-string)" },
	{ tag: tags.number, color: "var(--code-value)" },
	{ tag: [tags.bool, tags.null], color: "var(--code-keyword)" },
	{ tag: [tags.punctuation, tags.bracket, tags.separator], color: "var(--code-punctuation)" },
	{ tag: tags.invalid, color: "var(--text-error)" },
]);

const theme = EditorView.theme({
	"&": { height: "100%", fontSize: "var(--code-size)", backgroundColor: "var(--code-background)", borderRadius: "var(--radius-s)" },
	"&.cm-focused": { outline: "none" },
	".cm-scroller": { fontFamily: "var(--font-monospace)", lineHeight: "1.5" },
	".cm-content": { caretColor: "var(--caret-color, var(--text-normal))" },
	".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--caret-color, var(--text-normal))", borderLeftWidth: "2px" },
	".cm-gutters": { backgroundColor: "var(--code-background)", color: "var(--text-faint)", border: "none" },
	".cm-activeLineGutter": { backgroundColor: "transparent" },
	// Uses the theme's selection colour in place of CodeMirror's default.
	"&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionLayer .cm-selectionBackground": {
		backgroundColor: "var(--text-selection)",
	},
	".cm-searchMatch": { backgroundColor: "var(--text-highlight-bg)", outline: "none" },
	".cm-searchMatch-selected": { backgroundColor: "var(--text-highlight-bg-active, var(--interactive-accent))" },
});

const COUNT_LIMIT = 1000;

/** A compact floating find box. */
function createFindPanel(view: EditorView): Panel {
	const dom = createDiv({ cls: "carbonwire-find" });
	// openSearchPanel focuses the element marked main-field.
	const input = dom.createEl("input", { type: "text", attr: { placeholder: "Find", spellcheck: "false", "main-field": "true" } });
	input.value = getSearchQuery(view.state).search;
	const count = dom.createSpan({ cls: "carbonwire-find-count" });
	const button = (iconName: string, label: string, run: () => void) => {
		const b = dom.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
		setIcon(b, iconName);
		b.addEventListener("click", run);
	};
	// Keeps the caret in the find field, whose text CodeMirror selects after each jump.
	const keepCaret = (jump: (view: EditorView) => boolean) => {
		const { selectionStart, selectionEnd } = input;
		jump(view);
		input.setSelectionRange(selectionStart, selectionEnd);
	};
	button("arrow-up", "Previous match", () => findPrevious(view));
	button("arrow-down", "Next match", () => findNext(view));
	button("x", "Close", () => {
		closeSearchPanel(view);
		view.focus();
	});

	const updateCount = () => {
		const query = getSearchQuery(view.state);
		if (!query.search || !query.valid) {
			count.textContent = "";
			return;
		}
		const selection = view.state.selection.main;
		let total = 0;
		let current = 0;
		const cursor = query.getCursor(view.state);
		for (let match = cursor.next(); !match.done && total < COUNT_LIMIT; match = cursor.next()) {
			total++;
			if (match.value.from === selection.from && match.value.to === selection.to) current = total;
		}
		const totalText = total >= COUNT_LIMIT ? `${COUNT_LIMIT}+` : String(total);
		count.textContent = total === 0 ? "No results" : current ? `${current} of ${totalText}` : totalText;
	};

	input.addEventListener("input", () => {
		// Search again from the current match's start, so a longer query can still match there.
		view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: input.value })), selection: { anchor: view.state.selection.main.from } });
		if (input.value) keepCaret(findNext);
		updateCount();
	});
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			keepCaret(e.shiftKey ? findPrevious : findNext);
		} else if (e.key === "Escape") {
			e.preventDefault();
			closeSearchPanel(view);
			view.focus();
		}
	});

	return {
		dom,
		top: true,
		mount() {
			input.focus();
			input.select();
			updateCount();
		},
		update(update) {
			if (update.docChanged || update.selectionSet || update.transactions.some((t) => t.effects.some((e) => e.is(setSearchQuery)))) updateCount();
		},
	};
}

const setVariables = StateEffect.define<ReadonlySet<string> | undefined>();

/** Defined variable names; undefined means "don't highlight". */
const variablesField = StateField.define<ReadonlySet<string> | undefined>({
	create: () => undefined,
	update(value, tr) {
		for (const effect of tr.effects) if (effect.is(setVariables)) value = effect.value;
		return value;
	},
});

const variableMatcher = new MatchDecorator({
	regexp: /\{\{\s*([^{}]+?)\s*\}\}/g,
	decoration: (match, view) => {
		const names = view.state.field(variablesField);
		if (!names) return null;
		const name = match[1] ?? "";
		return Decoration.mark({ class: names.has(name) || isDynamicVariable(name) ? "carbonwire-var is-defined" : "carbonwire-var is-undefined" });
	},
});

/** Marks {{variables}} blue when defined in the current scope and red when not. */
const variableHighlighter = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = variableMatcher.createDeco(view);
		}

		update(update: ViewUpdate) {
			const namesChanged = update.transactions.some((t) => t.effects.some((e) => e.is(setVariables)));
			this.decorations = namesChanged ? variableMatcher.createDeco(update.view) : variableMatcher.updateDeco(update, this.decorations);
		}
	},
	{ decorations: (plugin) => plugin.decorations },
);

/** Mod-Enter is left to the request view, which sends the request. */
const editingKeymap = defaultKeymap.filter((binding) => binding.key !== "Mod-Enter");

export interface CodeEditorOptions {
	doc: string;
	language: CodeLanguage;
	readOnly: boolean;
	/** Wrap long lines instead of scrolling sideways. */
	wrap: boolean;
	onChange?: (doc: string) => void;
}

export interface CodeEditorHandle {
	view: EditorView;
	setDoc(doc: string): void;
	setLanguage(language: CodeLanguage): void;
	setVariables(names: ReadonlySet<string> | undefined): void;
	setWrap(wrap: boolean): void;
	openSearch(): void;
	destroy(): void;
}

export function createCodeEditor(parent: HTMLElement, options: CodeEditorOptions): CodeEditorHandle {
	const languageSlot = new Compartment();
	const wrapSlot = new Compartment();
	const languageFor = (language: CodeLanguage, size: number): Extension => (language === "json" && size <= HIGHLIGHT_LIMIT ? json() : []);

	const extensions: Extension[] = [
		lineNumbers(),
		foldGutter(),
		drawSelection(),
		bracketMatching(),
		highlightSelectionMatches(),
		search({ top: true, createPanel: createFindPanel }),
		syntaxHighlighting(highlightStyle),
		languageSlot.of(languageFor(options.language, options.doc.length)),
		wrapSlot.of(options.wrap ? EditorView.lineWrapping : []),
		theme,
		keymap.of([...searchKeymap, ...foldKeymap, ...(options.readOnly ? [] : [...historyKeymap, indentWithTab]), ...editingKeymap]),
	];
	if (options.readOnly) {
		extensions.push(EditorState.readOnly.of(true));
	} else {
		extensions.push(history(), indentOnInput(), variablesField, variableHighlighter);
		extensions.push(EditorView.updateListener.of((update) => {
			if (update.docChanged) options.onChange?.(update.state.doc.toString());
		}));
	}

	const view = new EditorView({ parent, state: EditorState.create({ doc: options.doc, extensions }) });
	let language = options.language;
	return {
		view,
		setDoc(doc) {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: doc },
				effects: languageSlot.reconfigure(languageFor(language, doc.length)),
			});
		},
		setLanguage(next) {
			language = next;
			view.dispatch({ effects: languageSlot.reconfigure(languageFor(next, view.state.doc.length)) });
		},
		setVariables(names) {
			if (!options.readOnly) view.dispatch({ effects: setVariables.of(names) });
		},
		setWrap(wrap) {
			view.dispatch({ effects: wrapSlot.reconfigure(wrap ? EditorView.lineWrapping : []) });
		},
		openSearch() {
			view.focus();
			openSearchPanel(view);
		},
		destroy() {
			view.destroy();
		},
	};
}
