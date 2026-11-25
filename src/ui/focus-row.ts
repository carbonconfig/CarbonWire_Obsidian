const FLASH_MS = 1500;

/** A variable to pick out in a settings tab; `create` adds it when it isn't there. */
export interface VariableFocus {
	variable: string;
	create?: boolean;
}

/** Puts the caret in the value of the `index`th variable row under `container`, scrolled into view and briefly highlighted. */
export function focusRow(container: HTMLElement, index: number): void {
	const row = container.querySelectorAll<HTMLElement>(".carbonwire-kv-row")[index];
	if (!row) return;
	const value = row.querySelector<HTMLInputElement>("input.carbonwire-kv-value, .carbonwire-kv-value input");
	row.scrollIntoView({ block: "center" });
	value?.focus();
	value?.select();
	row.classList.add("is-flashing");
	window.setTimeout(() => row.classList.remove("is-flashing"), FLASH_MS);
}
