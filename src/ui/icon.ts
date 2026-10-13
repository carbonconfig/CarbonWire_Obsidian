import { addIcon } from "obsidian";

export const CARBONWIRE_ICON = "carbonwire";

/*
 * Two half-arrows passing in opposite directions (data going back and forth) inside square brackets.
 * Drawn on Lucide's 24-unit grid with its stroke width, scaled to the 100-unit box Obsidian
 * expects for custom icons.
 */
const SVG = `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M6 4H3v16h3"/>
<path d="M18 4h3v16h-3"/>
<path d="M8 9.5h8l-2.5-2.5"/><path d="M16 14.5H8l2.5 2.5"/>
</g>`;

export function registerIcon(): void {
	addIcon(CARBONWIRE_ICON, SVG);
}
