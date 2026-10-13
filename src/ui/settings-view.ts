import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type { Folder, OpenCollection } from "../core/model";
import { basename, stem } from "../core/storage/paths";
import { COLLECTION_FILE, FOLDER_FILE } from "../core/storage/tree";
import { refreshTabTitle } from "./request-view";
import type CarbonWirePlugin from "../main";
import DefaultsEditor from "./DefaultsEditor.svelte";
import EnvironmentEditor from "./EnvironmentEditor.svelte";

/** The tab title for a collection, folder or environment file; also used before the tab loads. */
export function settingsTitle(path: string | undefined): string {
	if (!path) return "Settings";
	const name = basename(path);
	if (name === COLLECTION_FILE || name === FOLDER_FILE) return `${basename(path.slice(0, -name.length - 1)) || "Collection"} settings`;
	return `${stem(path)} environment`;
}

export const VIEW_TYPE_SETTINGS = "carbonwire-settings";

/** Editor for collection settings, folder settings and environments, chosen by file name. */
export class SettingsView extends ItemView {
	private path?: string;
	private editor?: Record<string, unknown>;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: CarbonWirePlugin) {
		super(leaf);
	}

	get file(): string | undefined {
		return this.path;
	}

	getViewType(): string {
		return VIEW_TYPE_SETTINGS;
	}

	getDisplayText(): string {
		return settingsTitle(this.path);
	}

	override getIcon(): string {
		return "settings-2";
	}

	override getState(): Record<string, unknown> {
		return { ...super.getState(), file: this.path };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const file = (state as { file?: unknown } | null)?.file;
		if (typeof file === "string" && file !== this.path) {
			this.path = file;
			await this.render();
		}
		await super.setState(state, result);
		refreshTabTitle(this.leaf);
	}

	/** Re-renders, because secret lookups are keyed by the environment's path. */
	renamed(path: string): void {
		this.path = path;
		void this.render();
		refreshTabTitle(this.leaf);
	}

	override async onClose(): Promise<void> {
		if (this.editor) await unmount(this.editor);
		this.editor = undefined;
	}

	private async render(): Promise<void> {
		await this.onClose();
		this.contentEl.empty();
		const path = this.path;
		if (!path) return;
		const { store } = this.plugin;
		const save = (doc: object) => store.saveEdited(this.path ?? path, doc);
		const name = basename(path);

		if (name === COLLECTION_FILE || name === FOLDER_FILE) {
			const doc = await store.loadDocument<OpenCollection | Folder>(path);
			this.editor = mount(DefaultsEditor, {
				target: this.contentEl,
				props: { initial: doc, kind: name === COLLECTION_FILE ? "collection" : "folder", onSave: save },
			});
			return;
		}

		const env = await store.loadEnvironment(path);
		this.editor = mount(EnvironmentEditor, {
			target: this.contentEl,
			props: {
				initial: env,
				onRename: async (name: string) => {
					const target = await this.plugin.actions.renameEnvironment(path, name);
					return target ? stem(target) : undefined;
				},
				getSecret: (variable: string) => this.plugin.secretFor(path, variable),
				setSecret: (variable: string, value: string) => this.plugin.setSecretFor(path, variable, value),
				onSave: save,
			},
		});
	}
}
