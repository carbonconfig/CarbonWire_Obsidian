import { normalizePath, PluginSettingTab, Setting, type App, type SettingDefinitionItem } from "obsidian";
import type { SortOrder } from "./core/storage/order";
import type CarbonWirePlugin from "./main";

export interface RequestLayout {
	/** "vertical": request on the left, response on the right. */
	orientation: "vertical" | "horizontal";
	/** Share of the space given to the request panel, from 0 to 1. */
	ratio: number;
}

export interface CarbonWireSettings {
	/** Where new collections are created; empty means the vault root. */
	collectionsFolder: string;
	/** Environments are shared by every collection and live in this folder. */
	environmentsFolder: string;
	/** Active environment name; empty means none. */
	activeEnvironment: string;
	maxResponseMB: number;
	/** Most recent sends kept in history on this device; 0 turns history off. */
	historySize: number;
	/** Wrap long lines in response bodies instead of scrolling sideways. */
	wrapResponseLines: boolean;
	rejectUnauthorized: boolean;
	requestLayout: RequestLayout;
	sortOrder: SortOrder;
	/** Collection roots in the order they were dragged to; others follow by name. */
	collectionOrder: string[];
	/** Environment names in the order they were dragged to; others follow by name. */
	environmentOrder: string[];
}

export const DEFAULT_SETTINGS: CarbonWireSettings = {
	collectionsFolder: "API Collections",
	environmentsFolder: "API Collections/Environments",
	activeEnvironment: "",
	maxResponseMB: 20,
	historySize: 100,
	wrapResponseLines: true,
	rejectUnauthorized: true,
	requestLayout: { orientation: "vertical", ratio: 0.5 },
	sortOrder: "manual",
	collectionOrder: [],
	environmentOrder: [],
};

const TEXT = {
	folder: ["Collections folder", "New collections are created in this folder. Existing collections are found anywhere in the vault."],
	environments: ["Environments folder", "Environments are shared by every collection. The active one overrides collection variables."],
	maxResponse: ["Response size limit", "In megabytes. Larger response bodies are truncated in memory; the full size is still reported."],
	wrap: ["Wrap long lines in responses", "Otherwise long lines scroll sideways. Also toggled from the response toolbar."],
	history: ["History size", "How many recent requests to keep, on this device only. Set to 0 to turn history off."],
	tls: ["Verify TLS certificates", "Turn off only for local servers with self-signed certificates."],
} as const;

export class CarbonWireSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: CarbonWirePlugin) {
		super(app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: TEXT.folder[0], desc: TEXT.folder[1], control: { type: "folder", key: "collectionsFolder", includeRoot: true, placeholder: "Vault root" } },
			{ name: TEXT.environments[0], desc: TEXT.environments[1], control: { type: "folder", key: "environmentsFolder", placeholder: DEFAULT_SETTINGS.environmentsFolder } },
			{ name: TEXT.maxResponse[0], desc: TEXT.maxResponse[1], control: { type: "number", key: "maxResponseMB", min: 1, step: 1 } },
			{ name: TEXT.history[0], desc: TEXT.history[1], control: { type: "number", key: "historySize", min: 0, step: 10 } },
			{ name: TEXT.wrap[0], desc: TEXT.wrap[1], control: { type: "toggle", key: "wrapResponseLines" } },
			{ name: TEXT.tls[0], desc: TEXT.tls[1], control: { type: "toggle", key: "rejectUnauthorized" } },
		];
	}

	/** Only used by Obsidian versions before 1.13, which lack declarative settings. */
	override display(): void {
		const { containerEl } = this;
		const { settings } = this.plugin;
		containerEl.empty();

		new Setting(containerEl).setName(TEXT.folder[0]).setDesc(TEXT.folder[1]).addText((text) =>
			text.setPlaceholder("Vault root").setValue(settings.collectionsFolder).onChange(async (value) => {
				settings.collectionsFolder = value.trim() ? normalizePath(value) : "";
				await this.plugin.saveSettings();
			}),
		);
		new Setting(containerEl).setName(TEXT.environments[0]).setDesc(TEXT.environments[1]).addText((text) =>
			text.setPlaceholder(DEFAULT_SETTINGS.environmentsFolder).setValue(settings.environmentsFolder).onChange(async (value) => {
				settings.environmentsFolder = value.trim() ? normalizePath(value) : DEFAULT_SETTINGS.environmentsFolder;
				await this.plugin.saveSettings();
			}),
		);
		new Setting(containerEl).setName(TEXT.maxResponse[0]).setDesc(TEXT.maxResponse[1]).addText((text) =>
			text.setValue(String(settings.maxResponseMB)).onChange(async (value) => {
				const mb = Number(value);
				if (!Number.isFinite(mb) || mb <= 0) return;
				settings.maxResponseMB = mb;
				await this.plugin.saveSettings();
			}),
		);
		new Setting(containerEl).setName(TEXT.history[0]).setDesc(TEXT.history[1]).addText((text) =>
			text.setValue(String(settings.historySize)).onChange(async (value) => {
				const size = Number(value);
				if (!Number.isInteger(size) || size < 0) return;
				settings.historySize = size;
				await this.plugin.saveSettings();
			}),
		);
		new Setting(containerEl).setName(TEXT.wrap[0]).setDesc(TEXT.wrap[1]).addToggle((toggle) =>
			toggle.setValue(settings.wrapResponseLines).onChange((value) => void this.plugin.setWrapResponseLines(value)),
		);
		new Setting(containerEl).setName(TEXT.tls[0]).setDesc(TEXT.tls[1]).addToggle((toggle) =>
			toggle.setValue(settings.rejectUnauthorized).onChange(async (value) => {
				settings.rejectUnauthorized = value;
				await this.plugin.saveSettings();
			}),
		);
	}
}
