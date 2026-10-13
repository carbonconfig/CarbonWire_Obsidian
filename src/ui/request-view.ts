import { ItemView, Notice, Scope, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type { HttpRequest } from "../core/model";
import type { SendResult } from "../core/sender";
import { stem } from "../core/storage/paths";
import type CarbonWirePlugin from "../main";
import type { EnvironmentEntry } from "../main";
import type { RequestLayout } from "../settings";
import { CARBONWIRE_ICON } from "./icon";
import { promptNewRequest, requestLocations } from "./prompt";
import type { RequestController } from "./request-controller";
import RequestEditor from "./RequestEditor.svelte";

export const VIEW_TYPE_REQUEST = "carbonwire-request";

/** An unsaved request, kept in the tab's state so it survives a restart. */
export interface DraftState {
	name: string;
	request: HttpRequest;
	/** Where Save suggests putting it. */
	dir?: string;
	/** The history entry it was opened from, whose response is shown. */
	historyId?: number;
}

/** The tab title for a request tab's state; also used before the tab loads. */
export function requestTitle(state: { file?: unknown; draft?: { name?: unknown } }): string {
	if (typeof state.file === "string") return stem(state.file);
	return typeof state.draft?.name === "string" ? state.draft.name : "Request";
}

/** Functions exported by RequestEditor.svelte. */
interface EditorApi {
	setEnvironment(environment: EnvironmentEntry | undefined): void;
	setLayout(layout: RequestLayout): void;
	setWrap(wrap: boolean): void;
	setName(name: string): void;
	focusUrl(): void;
	restore(result: SendResult | undefined, time: number, error?: string): void;
	snapshot(): HttpRequest;
	save(): Promise<void>;
	send(): Promise<void>;
	find(): void;
	refreshVariables(): Promise<void>;
}

/** Obsidian refreshes a tab's title through this undocumented method; it may not exist. */
export function refreshTabTitle(leaf: WorkspaceLeaf): void {
	(leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
}

export class RequestView extends ItemView {
	private path?: string;
	private draft?: DraftState;
	private editor?: EditorApi;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: CarbonWirePlugin) {
		super(leaf);
		// Active only while this tab is focused, wherever the cursor is inside it.
		this.scope = new Scope(this.app.scope);
		this.scope.register(["Mod"], "Enter", () => {
			this.send();
			return false;
		});
		this.scope.register(["Mod"], "f", () => {
			this.editor?.find();
			return false;
		});
		// Saved requests save automatically, so Mod+S only matters while a request is unsaved.
		this.scope.register(["Mod"], "s", () => {
			if (!this.draft) return true;
			void this.editor?.save();
			return false;
		});
	}

	send(): void {
		void this.editor?.send();
	}

	focusUrl(): void {
		this.editor?.focusUrl();
	}

	/** The request's file, or undefined while it's unsaved. */
	get file(): string | undefined {
		return this.path;
	}

	getViewType(): string {
		return VIEW_TYPE_REQUEST;
	}

	getDisplayText(): string {
		return requestTitle({ file: this.path, draft: this.draft });
	}

	override getIcon(): string {
		return CARBONWIRE_ICON;
	}

	override getState(): Record<string, unknown> {
		const draft = this.draft && { ...this.draft, request: this.editor?.snapshot() ?? this.draft.request };
		return { ...super.getState(), ...(this.path ? { file: this.path } : draft ? { draft } : {}) };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const { file, draft } = (state ?? {}) as { file?: unknown; draft?: DraftState };
		if (typeof file === "string" && file !== this.path) {
			this.path = file;
			this.draft = undefined;
			await this.render();
		} else if (draft && !this.path && !this.draft) {
			this.draft = draft;
			await this.render();
		}
		await super.setState(state, result);
		refreshTabTitle(this.leaf);
	}

	/** Keeps the tab pointing at the file after a rename without reloading the editor. */
	renamed(path: string): void {
		this.path = path;
		this.editor?.setName(stem(path));
		refreshTabTitle(this.leaf);
	}

	override async onOpen(): Promise<void> {
		// Collections-changed also fires when an environment is renamed or recoloured.
		const updateEnvironment = () => this.editor?.setEnvironment(this.plugin.activeEnvironmentEntry());
		this.register(this.plugin.onCollectionsChanged(updateEnvironment));
		this.register(this.plugin.onEnvironmentChanged(updateEnvironment));
		this.register(this.plugin.onRequestLayoutChanged((layout) => this.editor?.setLayout(layout)));
		this.register(this.plugin.onWrapResponseLinesChanged((wrap) => this.editor?.setWrap(wrap)));
		this.register(this.plugin.onDocumentsChanged(() => void this.editor?.refreshVariables()));
	}

	override async onClose(): Promise<void> {
		await this.teardown();
	}

	private async teardown(): Promise<void> {
		if (this.editor) await unmount(this.editor);
		this.editor = undefined;
	}

	private async render(): Promise<void> {
		await this.teardown();
		this.contentEl.empty();
		const loaded = this.path ? await this.loadFile(this.path) : this.draft && { request: this.draft.request, name: this.draft.name };
		if (!loaded) return;
		const restored = this.draft?.historyId === undefined ? undefined : await this.loadHistory(this.draft.historyId);

		const { plugin } = this;
		const controller: RequestController = {
			save: async (next) => {
				if (this.path) await plugin.store.saveEdited(this.path, next);
				else if (this.draft) {
					this.draft.request = next;
					this.app.workspace.requestSaveLayout();
				}
			},
			saveDraft: (name, next) => this.saveDraft(name, next),
			send: async (name, next, signal, onProgress) => {
				const result = await plugin.send(this.path, name, next, signal, onProgress);
				// The tab now shows this response, not the one it was opened from.
				if (this.draft) this.draft.historyId = undefined;
				return result;
			},
			openEnvironment: (environmentPath) => void plugin.openFile(environmentPath),
			setLayout: (layout) => void plugin.setRequestLayout(layout),
			setWrap: (wrap) => void plugin.setWrapResponseLines(wrap),
			variableNames: (next) => plugin.variableNames(this.path, next),
			rename: async (name) => {
				if (!this.path) {
					if (this.draft) this.draft.name = name;
					refreshTabTitle(this.leaf);
					this.app.workspace.requestSaveLayout();
					return name;
				}
				const target = await plugin.actions.renameRequest(this.path, name);
				return target ? stem(target) : undefined;
			},
			copyCurl: (next) => plugin.copyCurl(this.path, next),
			notify: (message) => new Notice(message),
		};
		this.editor = mount(RequestEditor, {
			target: this.contentEl,
			props: {
				initial: loaded.request,
				initialName: loaded.name,
				initialDraft: !this.path,
				initialResult: restored?.result,
				restoredAt: restored?.time,
				initialEnvironment: plugin.activeEnvironmentEntry(),
				initialLayout: plugin.requestLayout(),
				initialWrap: plugin.settings.wrapResponseLines,
				controller,
			},
		}) as EditorApi;
		if (this.path) void this.restoreLatest(this.path);
	}

	/** Shows the request's most recent send from history, once it has loaded. */
	private async restoreLatest(path: string): Promise<void> {
		const entry = await this.plugin.history.latestFor(path).catch(() => undefined);
		if (!entry || this.path !== path) return;
		if (entry.error) {
			this.editor?.restore(undefined, entry.time, entry.error);
			return;
		}
		const restored = await this.loadHistory(entry.id);
		if (restored && this.path === path) this.editor?.restore(restored.result, restored.time);
	}

	private async loadFile(path: string): Promise<{ request: HttpRequest; name: string } | undefined> {
		if (!this.plugin.collectionFor(path)) {
			this.contentEl.createEl("p", { text: "This file is not inside a CarbonWire collection.", cls: "carbonwire-muted" });
			return undefined;
		}
		try {
			return { request: await this.plugin.store.loadRequest(path), name: stem(path) };
		} catch (e) {
			this.contentEl.createEl("p", { text: `Could not read ${path}: ${e instanceof Error ? e.message : String(e)}`, cls: "carbonwire-error" });
			return undefined;
		}
	}

	/** Rebuilds a send result from history; `sent` shows the request as written. */
	private async loadHistory(id: number): Promise<{ result: SendResult; time: number } | undefined> {
		const found = await this.plugin.history.get(id).catch(() => undefined);
		const response = found?.entry.response;
		if (!found || !response) return undefined;
		const http = found.entry.request.http ?? {};
		return {
			time: found.entry.time,
			result: {
				sent: { method: http.method ?? "GET", url: http.url ?? "", headers: [], bodyBytes: 0 },
				response: { ...response, url: "", body: found.body, redirects: [] },
				warnings: [],
			},
		};
	}

	/** Asks where to save an unsaved request, then turns this tab into that file's tab. */
	private async saveDraft(name: string, request: HttpRequest): Promise<string | undefined> {
		const { plugin } = this;
		const locations = requestLocations(plugin.collections());
		if (locations.length === 0) {
			new Notice("Create a collection first.");
			return undefined;
		}
		const choice = await promptNewRequest(this.app, locations, { name, dir: this.draft?.dir });
		if (!choice) return undefined;
		// Drops any sidebar position carried over from the request it came from.
		const copy = structuredClone(request);
		delete copy.info?.seq;
		const path = await plugin.store.createRequest(choice.dir, choice.name, copy);
		this.path = path;
		this.draft = undefined;
		refreshTabTitle(this.leaf);
		this.app.workspace.requestSaveLayout();
		plugin.noteActiveRequest(path);
		return stem(path);
	}
}
