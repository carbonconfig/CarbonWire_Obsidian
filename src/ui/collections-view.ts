import { ItemView, Menu, Notice, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import { joinPath, stem } from "../core/storage/paths";
import type { SortOrder } from "../core/storage/order";
import { COLLECTION_FILE, type CollectionNode } from "../core/storage/tree";
import type CarbonWirePlugin from "../main";
import type { EnvironmentEntry } from "../main";
import type { HistoryEntry } from "../obsidian/history";
import { defaultEnvColor } from "./env-colors";
import { CARBONWIRE_ICON } from "./icon";
import { confirmAction, promptEnvironment, promptText } from "./prompt";
import Sidebar from "./Sidebar.svelte";
import type { MenuTarget } from "./tree-types";

export const VIEW_TYPE_COLLECTIONS = "carbonwire-collections";

/** Functions exported by Sidebar.svelte. */
interface SidebarApi {
	update(collections: CollectionNode[], environments: EnvironmentEntry[]): void;
	setActive(path: string | undefined): void;
	environmentChanged(name: string): void;
	setHistory(entries: readonly HistoryEntry[]): void;
}

const SORT_OPTIONS: readonly (readonly [SortOrder, string])[][] = [
	[["manual", "Manual (drag to reorder)"]],
	[
		["name-asc", "Name (A to Z)"],
		["name-desc", "Name (Z to A)"],
	],
	[
		["modified-desc", "Last updated (newest first)"],
		["modified-asc", "Last updated (oldest first)"],
	],
	[
		["created-desc", "Created (newest first)"],
		["created-asc", "Created (oldest first)"],
	],
];

export class CollectionsView extends ItemView {
	private sidebar?: SidebarApi;
	private historyShown = false;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: CarbonWirePlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_COLLECTIONS;
	}

	getDisplayText(): string {
		return "CarbonWire";
	}

	override getIcon(): string {
		return CARBONWIRE_ICON;
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("carbonwire-sidebar-view");
		const { plugin } = this;
		this.sidebar = mount(Sidebar, {
			target: this.contentEl,
			props: {
				initial: plugin.collections(),
				initialEnvironments: plugin.environmentEntries(),
				initialActiveEnvironment: plugin.activeEnvironment(),
				onOpen: (path: string) => void plugin.openRequest(path),
				onMenu: (event: MouseEvent, target: MenuTarget) => this.showMenu(event, target),
				onAdd: (event: MouseEvent, target: MenuTarget) => this.showAddMenu(event, target),
				onNewCollection: () => void this.newCollection(),
				onNewEnvironment: () => void this.newEnvironment(),
				onAddMenu: (event: MouseEvent) => this.showTopAddMenu(event),
				onImportMenu: (event: MouseEvent) => this.showImportMenu(event),
				onSelectEnvironment: (name: string) => void plugin.setActiveEnvironment(name),
				onEditEnvironment: (path: string) => void plugin.openFile(path),
				onSortMenu: (event: MouseEvent) => this.showSortMenu(event),
				onMove: (path: string, dir: string, anchor: string | undefined, position: "before" | "after" | "end") =>
					void plugin.actions.moveTreeItem(path, dir, anchor, position),
				onMoveCollection: (root: string, anchor: string, position: "before" | "after") => void plugin.actions.moveCollection(root, anchor, position),
				onMoveEnvironment: (path: string, anchor: string, position: "before" | "after") => void plugin.moveEnvironment(path, anchor, position),
				onShowHistory: () => {
					this.historyShown = true;
					void this.loadHistory();
				},
				onOpenHistory: (entry: HistoryEntry) => void plugin.openHistoryEntry(entry),
				onHistoryMenu: (event: MouseEvent, entry: HistoryEntry) => this.showHistoryMenu(event, entry),
				onClearHistory: () => void this.clearHistory(),
			},
		}) as SidebarApi;
		this.register(plugin.onCollectionsChanged((next) => this.sidebar?.update(next, plugin.environmentEntries())));
		this.register(plugin.onActiveRequestChanged((path) => this.sidebar?.setActive(path)));
		this.register(plugin.onEnvironmentChanged((name) => this.sidebar?.environmentChanged(name)));
		this.register(plugin.onHistoryChanged(() => this.historyShown && void this.loadHistory()));
	}

	override async onClose(): Promise<void> {
		if (this.sidebar) await unmount(this.sidebar);
		this.sidebar = undefined;
	}

	private async newCollection(): Promise<void> {
		const name = await promptText(this.app, "New collection", "My API");
		if (!name) return;
		const root = await this.plugin.store.createCollection(this.plugin.collectionsFolder(), name);
		new Notice(`Created collection "${name}" in ${root || "the vault root"}`);
	}

	/** Opens an unsaved request; from a collection or folder, Save suggests that location. */
	private newRequest(dir?: string): void {
		void this.plugin.openDraft({ dir });
	}

	private async loadHistory(): Promise<void> {
		try {
			this.sidebar?.setHistory([...(await this.plugin.history.list())]);
		} catch (e) {
			new Notice(`Couldn't load history: ${e instanceof Error ? e.message : String(e)}`);
			this.sidebar?.setHistory([]);
		}
	}

	private async clearHistory(): Promise<void> {
		const ok = await confirmAction(this.app, "Clear history", "Remove every request and response from history on this device?", "Clear");
		if (ok) await this.plugin.history.clear();
	}

	private showHistoryMenu(event: MouseEvent, entry: HistoryEntry): void {
		event.preventDefault();
		const { plugin } = this;
		const menu = new Menu();
		const source = entry.source && this.app.vault.getFileByPath(entry.source) ? entry.source : undefined;
		menu.addItem((item) => item.setTitle("Open").setIcon("file").onClick(() => void plugin.openHistoryEntry(entry)));
		if (source) menu.addItem((item) => item.setTitle("Open saved request").setIcon("file-text").onClick(() => void plugin.openRequest(source)));
		menu.addItem((item) => item.setTitle("Copy as cURL").setIcon("terminal").onClick(() => void plugin.copyCurl(source, entry.request)));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle("Delete from history").setIcon("trash").setWarning(true).onClick(() => void plugin.history.remove([entry.id])));
		menu.showAtMouseEvent(event);
	}

	private async newFolder(dir: string): Promise<void> {
		const name = await promptText(this.app, "New folder", "Users");
		if (name) await this.plugin.store.createFolder(dir, name);
	}

	private async newEnvironment(): Promise<void> {
		const { plugin } = this;
		const choice = await promptEnvironment(this.app, { title: "New environment", action: "Create", color: defaultEnvColor(plugin.environments().length) });
		if (!choice) return;
		const path = await plugin.store.createEnvironmentIn(plugin.environmentsFolder(), choice.name, { name: choice.name, color: choice.color, variables: [] });
		await plugin.setActiveEnvironment(stem(path));
		await plugin.openFile(path);
	}

	private showTopAddMenu(event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle("New collection").setIcon("folder-plus").onClick(() => void this.newCollection()));
		menu.addItem((item) => item.setTitle("New request").setIcon("file-plus").onClick(() => this.newRequest()));
		menu.addItem((item) => item.setTitle("New environment").setIcon("globe").onClick(() => void this.newEnvironment()));
		menu.showAtMouseEvent(event);
	}

	private showSortMenu(event: MouseEvent): void {
		const menu = new Menu();
		const current = this.plugin.sortOrder();
		for (const [i, group] of SORT_OPTIONS.entries()) {
			if (i > 0) menu.addSeparator();
			for (const [order, title] of group) {
				menu.addItem((item) =>
					item
						.setTitle(title)
						.setChecked(order === current)
						.onClick(() => void this.plugin.setSortOrder(order)),
				);
			}
		}
		menu.showAtMouseEvent(event);
	}

	private showImportMenu(event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle("Import collection…").setIcon("folder-input").onClick(() => void this.plugin.openImport()));
		menu.addItem((item) => item.setTitle("Import environment…").setIcon("globe").onClick(() => void this.plugin.openImport({ environments: true })));
		menu.showAtMouseEvent(event);
	}

	private showAddMenu(event: MouseEvent, target: MenuTarget): void {
		event.preventDefault();
		if (target.kind !== "collection" && target.kind !== "folder") return;
		const dir = target.kind === "collection" ? target.collection.root : target.folder.path;
		const menu = new Menu();
		menu.addItem((item) => item.setTitle("New request").setIcon("file-plus").onClick(() => this.newRequest(dir)));
		menu.addItem((item) => item.setTitle("New folder").setIcon("folder-plus").onClick(() => void this.newFolder(dir)));
		menu.showAtMouseEvent(event);
	}

	/** One menu per item, shared by right-click and the ⋯ button. */
	private showMenu(event: MouseEvent, target: MenuTarget): void {
		event.preventDefault();
		const menu = new Menu();
		const { plugin } = this;
		const { actions } = plugin;

		switch (target.kind) {
			case "collection": {
				const root = target.collection.root;
				const { environments } = target.collection;
				menu.addItem((item) => item.setTitle("New request").setIcon("file-plus").onClick(() => this.newRequest(root)));
				menu.addItem((item) => item.setTitle("New folder").setIcon("folder-plus").onClick(() => void this.newFolder(root)));
				menu.addSeparator();
				menu.addItem((item) => item.setTitle("Import into collection…").setIcon("import").onClick(() => void plugin.openImport({ collectionRoot: root })));
				menu.addItem((item) => item.setTitle("Collection settings").setIcon("settings").onClick(() => void plugin.openFile(joinPath(root, COLLECTION_FILE))));
				if (environments.length > 0) {
					const title = environments.length === 1 ? "Add its environment to the shared list" : `Add its ${environments.length} environments to the shared list`;
					menu.addItem((item) => item.setTitle(title).setIcon("globe").onClick(() => void actions.copyCollectionEnvironments(environments)));
				}
				break;
			}
			case "folder": {
				const dir = target.folder.path;
				menu.addItem((item) => item.setTitle("New request").setIcon("file-plus").onClick(() => this.newRequest(dir)));
				menu.addItem((item) => item.setTitle("New folder").setIcon("folder-plus").onClick(() => void this.newFolder(dir)));
				menu.addSeparator();
				menu.addItem((item) => item.setTitle("Rename").setIcon("pencil").onClick(() => void actions.renameFolder(dir)));
				menu.addItem((item) =>
					item.setTitle("Folder settings").setIcon("settings").onClick(async () => {
						await plugin.openFile(await plugin.store.ensureFolderConfig(dir));
					}),
				);
				menu.addSeparator();
				menu.addItem((item) => item.setTitle("Delete").setIcon("trash").setWarning(true).onClick(() => void actions.deleteFolder(dir)));
				break;
			}
			case "request": {
				const path = target.request.path;
				menu.addItem((item) => item.setTitle("Open").setIcon("file").onClick(() => void plugin.openRequest(path)));
				menu.addItem((item) => item.setTitle("Rename").setIcon("pencil").onClick(() => void actions.renameRequest(path)));
				menu.addItem((item) => item.setTitle("Duplicate").setIcon("copy").onClick(() => void actions.duplicateRequest(path)));
				menu.addItem((item) =>
					item.setTitle("Copy as cURL").setIcon("terminal").onClick(async () => {
						await plugin.copyCurl(path, await plugin.store.loadRequest(path));
					}),
				);
				menu.addSeparator();
				menu.addItem((item) => item.setTitle("Delete").setIcon("trash").setWarning(true).onClick(() => void actions.deleteRequest(path)));
				break;
			}
			case "environment": {
				const { path } = target;
				const isActive = plugin.activeEnvironment() === stem(path);
				menu.addItem((item) =>
					item
						.setTitle(isActive ? "Deactivate" : "Activate")
						.setIcon(isActive ? "circle" : "circle-dot")
						.onClick(() => void plugin.setActiveEnvironment(isActive ? "" : stem(path))),
				);
				menu.addItem((item) => item.setTitle("Edit").setIcon("pencil-line").onClick(() => void plugin.openFile(path)));
				menu.addItem((item) => item.setTitle("Rename and colour…").setIcon("palette").onClick(() => void actions.renameEnvironment(path)));
				menu.addItem((item) => item.setTitle("Duplicate").setIcon("copy").onClick(() => void actions.duplicateEnvironment(path)));
				menu.addSeparator();
				menu.addItem((item) => item.setTitle("Delete").setIcon("trash").setWarning(true).onClick(() => void actions.deleteEnvironment(path)));
				break;
			}
		}
		menu.showAtMouseEvent(event);
	}
}
