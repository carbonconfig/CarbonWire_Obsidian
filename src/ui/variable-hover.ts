import { Platform } from "obsidian";
import { isDynamicVariable, type VariableInfo } from "../core/variables";
import type { VariablesContext } from "./variables-context";

const SHOW_DELAY_MS = 300;
const isMac = Platform.isMacOS || Platform.isIosApp;
const MODIFIER = isMac ? "Cmd" : "Ctrl";

/** Ctrl, or Cmd on a Mac, turns a hovered variable into a link. */
export function isLinkModifier(e: MouseEvent | KeyboardEvent): boolean {
	return isMac ? e.metaKey : e.ctrlKey;
}

/** Ctrl+Click, or Cmd+Click on a Mac, opens a variable. */
export function isEditClick(e: MouseEvent): boolean {
	return e.button === 0 && isLinkModifier(e);
}

let tip: HTMLDivElement | undefined;
let timer: number | undefined;
let shown: string | undefined;

function sourceText(info: VariableInfo): string {
	switch (info.source) {
		case "globals":
			return "From globals";
		case "environment":
			return `From the ${info.label ?? "active"} environment`;
		case "collection":
			return info.label ? `From the ${info.label} collection` : "From the collection";
		case "folder":
			return `From the ${info.label ?? ""} folder`;
		case "request":
			return "From this request's file";
		case "runtime":
			return "Set by a response; kept until CarbonWire restarts";
	}
}

function render(context: VariablesContext, name: string): HTMLDivElement {
	const el = createDiv({ cls: "carbonwire-var-tip", attr: { role: "tooltip" } });
	const line = (cls: string, text: string) => el.createDiv({ cls, text });
	const info = context.info?.get(name);
	if (info) {
		if (info.value === "") line("carbonwire-var-tip-value is-empty", "Empty");
		else line("carbonwire-var-tip-value", info.value);
		line("carbonwire-var-tip-source", sourceText(info) + (info.secret ? ", kept secret" : ""));
		if (info.source !== "request" && info.source !== "runtime") line("carbonwire-var-tip-hint", `${MODIFIER}+Click to edit`);
	} else if (isDynamicVariable(name)) {
		line("carbonwire-var-tip-source", "Dynamic: a new value each time the request is sent");
	} else {
		line("carbonwire-var-tip-value is-empty", "Not set");
		line("carbonwire-var-tip-hint", `${MODIFIER}+Click to add it to ${context.environment ? `the ${context.environment} environment` : "globals"}`);
	}
	return el;
}

/** Shows the variable's value under `anchor` after a moment, in the window in use; the same variable stays put. */
export function showVariable(context: VariablesContext, name: string, anchor: () => DOMRect, key: string): void {
	if (shown === key) return;
	hideVariable();
	shown = key;
	timer = window.setTimeout(() => {
		tip = render(context, name);
		activeDocument.body.append(tip);
		const rect = anchor();
		const { width, height } = tip.getBoundingClientRect();
		const below = rect.bottom + 4 + height <= activeWindow.innerHeight;
		tip.style.left = `${Math.max(4, Math.min(rect.left, activeWindow.innerWidth - width - 4))}px`;
		tip.style.top = `${below ? rect.bottom + 4 : Math.max(4, rect.top - height - 4)}px`;
	}, SHOW_DELAY_MS);
}

export function hideVariable(): void {
	window.clearTimeout(timer);
	tip?.remove();
	tip = undefined;
	shown = undefined;
}

/**
 * Hovers and Ctrl+Clicks on the {{variables}} a field's mirror draws: the field sits on top, so
 * the variable under the pointer is found by position. Marks carry their name in `data-variable`.
 */
export function mirrorHover(node: HTMLElement, params: { context: VariablesContext | undefined; mirror: () => HTMLElement | undefined }) {
	let hovered: HTMLElement | undefined;
	const markAt = (e: MouseEvent) => {
		for (const mark of params.mirror()?.querySelectorAll<HTMLElement>("mark[data-variable]") ?? []) {
			for (const r of mark.getClientRects()) {
				if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return mark;
			}
		}
		return undefined;
	};
	const setHovered = (mark: HTMLElement | undefined, e?: MouseEvent) => {
		if (hovered !== mark) hovered?.classList.remove("is-hovered");
		hovered = mark;
		mark?.classList.add("is-hovered");
		node.classList.toggle("is-linking", mark !== undefined && e !== undefined && isLinkModifier(e));
	};
	const move = (e: MouseEvent) => {
		const context = params.context;
		const mark = context ? markAt(e) : undefined;
		setHovered(mark, e);
		if (!mark || !context) return hideVariable();
		const index = [...(params.mirror()?.querySelectorAll<HTMLElement>("mark") ?? [])].indexOf(mark);
		showVariable(context, mark.dataset.variable!, () => mark.getBoundingClientRect(), `${index}:${mark.dataset.variable}`);
	};
	const leave = () => {
		setHovered(undefined);
		hideVariable();
	};
	const down = (e: MouseEvent) => {
		if (!isEditClick(e) || !params.context) return;
		const mark = markAt(e);
		if (!mark) return;
		e.preventDefault();
		leave();
		params.context.edit(mark.dataset.variable!);
	};
	node.addEventListener("mousemove", move);
	node.addEventListener("mouseleave", leave);
	node.addEventListener("mousedown", down);
	// Typing changes what's under the pointer.
	node.addEventListener("keydown", leave);
	return {
		update(next: typeof params) {
			params = next;
		},
		destroy() {
			leave();
			node.removeEventListener("mousemove", move);
			node.removeEventListener("mouseleave", leave);
			node.removeEventListener("mousedown", down);
			node.removeEventListener("keydown", leave);
		},
	};
}
