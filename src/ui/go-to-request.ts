import { FuzzySuggestModal, type App, type FuzzyMatch } from "obsidian";
import { listRequests, type RequestEntry } from "../core/storage/tree";
import type CarbonWirePlugin from "../main";

/** Finds a request by name, collection or folder across every collection, and opens it. */
export class GoToRequestModal extends FuzzySuggestModal<RequestEntry> {
	constructor(app: App, private readonly plugin: CarbonWirePlugin) {
		super(app);
		this.setPlaceholder("Search requests in every collection");
	}

	getItems(): RequestEntry[] {
		return listRequests(this.plugin.collections());
	}

	getItemText(item: RequestEntry): string {
		return `${item.name} ${[item.collection, ...item.folders].join(" / ")}`;
	}

	override renderSuggestion(match: FuzzyMatch<RequestEntry>, el: HTMLElement): void {
		const { item } = match;
		const method = this.plugin.index.metaFor(item.path)?.method?.toUpperCase() ?? "GET";
		el.addClass("carbonwire-goto");
		el.createSpan({ cls: "carbonwire-method carbonwire-method-badge", text: method, attr: { "data-method": method } });
		el.createSpan({ cls: "carbonwire-goto-name", text: item.name });
		el.createSpan({ cls: "carbonwire-goto-where", text: [item.collection, ...item.folders].join(" / ") });
	}

	onChooseItem(item: RequestEntry): void {
		void this.plugin.openRequest(item.path);
	}
}
