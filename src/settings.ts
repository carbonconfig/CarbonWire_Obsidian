import { normalizePath, Notice, PluginSettingTab, Setting, type App, type SettingDefinitionItem } from "obsidian";
import type { SortOrder } from "./core/storage/order";
import type CarbonWirePlugin from "./main";
import { certificateSecret, parseCertificates, PROXY_SECRET } from "./obsidian/network";
import { promptText } from "./ui/prompt";

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
	/** Folders and files never searched for collections: glob patterns relative to the vault, one per line. */
	excludedFolders: string;
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
	/** "environment" reads HTTP_PROXY, HTTPS_PROXY and NO_PROXY; "custom" uses `proxyUrl`. */
	proxyMode: "none" | "environment" | "custom";
	proxyUrl: string;
	/** Hosts that skip the custom proxy, NO_PROXY style. */
	proxyBypass: string;
	/** One per line: a host pattern, then a certificate and key, or a PKCS #12 file. */
	clientCertificates: string;
	/** PEM files of certificate authorities to trust besides the system's, one per line. */
	caCertificates: string;
	/** The language last picked in a request's Code tab. */
	snippetLanguage: string;
}

export const DEFAULT_SETTINGS: CarbonWireSettings = {
	collectionsFolder: "API Collections",
	environmentsFolder: "API Collections/Environments",
	excludedFolders: "",
	activeEnvironment: "",
	maxResponseMB: 20,
	historySize: 100,
	wrapResponseLines: true,
	rejectUnauthorized: true,
	requestLayout: { orientation: "vertical", ratio: 0.5 },
	sortOrder: "manual",
	collectionOrder: [],
	environmentOrder: [],
	proxyMode: "none",
	proxyUrl: "",
	proxyBypass: "localhost, 127.0.0.1, ::1",
	clientCertificates: "",
	caCertificates: "",
	snippetLanguage: "curl",
};

const TEXT = {
	folder: ["Collections folder", "New collections are created in this folder. Existing collections are found anywhere in the vault."],
	environments: ["Environments folder", "Environments are shared by every collection. The active one overrides collection variables."],
	excluded: ["Excluded folders", "Never searched for collections. One per line, relative to the vault: a folder such as Archive/Old APIs, or a pattern such as **/fixtures."],
	maxResponse: ["Response size limit", "In megabytes. Larger response bodies are truncated in memory; the full size is still reported."],
	wrap: ["Wrap long lines in responses", "Otherwise long lines scroll sideways. Also toggled from the response toolbar."],
	history: ["History size", "How many recent requests to keep, on this device only. Set to 0 to turn history off."],
	tls: ["Verify TLS certificates", "Turn off only for local servers with self-signed certificates."],
	proxy: ["Proxy", "How requests reach the server. HTTP, HTTPS and SOCKS5 proxies work."],
	proxyUrl: ["Proxy URL", "For a custom proxy: http://proxy:3128, https://proxy:443 or socks5://user@proxy:1080."],
	proxyBypass: ["Hosts that skip the proxy", "Separated by commas: example.com (and its subdomains), .internal, host:8443, or * for all."],
	proxyPassword: ["Proxy password", "Kept in Obsidian's secret storage on this device, never in the plugin's settings."],
	certificates: [
		"Client certificates",
		"For mutual TLS. One per line: a host such as api.example.com or *.example.com, then a PEM certificate and key, or a .p12 or .pfx file. Paths are relative to the vault unless absolute.",
	],
	passphrase: ["Client certificate passphrase", "For an encrypted key or a PKCS #12 file. Kept in Obsidian's secret storage on this device."],
	ca: ["Certificate authorities", "PEM files of certificate authorities to trust besides your system's, such as a company's internal CA. One per line."],
} as const;

const PROXY_OPTIONS = { none: "No proxy", environment: "From the environment (HTTP_PROXY, NO_PROXY)", custom: "Custom" } as const;

export class CarbonWireSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: CarbonWirePlugin) {
		super(app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: TEXT.folder[0], desc: TEXT.folder[1], control: { type: "folder", key: "collectionsFolder", includeRoot: true, placeholder: "Vault root" } },
			{ name: TEXT.environments[0], desc: TEXT.environments[1], control: { type: "folder", key: "environmentsFolder", placeholder: DEFAULT_SETTINGS.environmentsFolder } },
			{ name: TEXT.excluded[0], desc: TEXT.excluded[1], control: { type: "textarea", key: "excludedFolders", rows: 2, placeholder: "**/fixtures" } },
			{ name: TEXT.maxResponse[0], desc: TEXT.maxResponse[1], control: { type: "number", key: "maxResponseMB", min: 1, step: 1 } },
			{ name: TEXT.history[0], desc: TEXT.history[1], control: { type: "number", key: "historySize", min: 0, step: 10 } },
			{ name: TEXT.wrap[0], desc: TEXT.wrap[1], control: { type: "toggle", key: "wrapResponseLines" } },
			{ name: TEXT.tls[0], desc: TEXT.tls[1], control: { type: "toggle", key: "rejectUnauthorized" } },
			{
				type: "group",
				heading: "Network",
				items: [
					{ name: TEXT.proxy[0], desc: TEXT.proxy[1], control: { type: "dropdown", key: "proxyMode", options: PROXY_OPTIONS } },
					{ name: TEXT.proxyUrl[0], desc: TEXT.proxyUrl[1], visible: () => this.plugin.settings.proxyMode === "custom", control: { type: "text", key: "proxyUrl", placeholder: "http://proxy:3128" } },
					{ name: TEXT.proxyBypass[0], desc: TEXT.proxyBypass[1], visible: () => this.plugin.settings.proxyMode === "custom", control: { type: "text", key: "proxyBypass" } },
					{ name: TEXT.proxyPassword[0], desc: TEXT.proxyPassword[1], visible: () => this.plugin.settings.proxyMode === "custom", action: () => void this.setProxyPassword() },
					{ name: TEXT.certificates[0], desc: TEXT.certificates[1], control: { type: "textarea", key: "clientCertificates", rows: 3, placeholder: "api.example.com certs/client.pem certs/client.key" } },
					{ name: TEXT.passphrase[0], desc: TEXT.passphrase[1], action: () => void this.setPassphrase() },
					{ name: TEXT.ca[0], desc: TEXT.ca[1], control: { type: "textarea", key: "caCertificates", rows: 2, placeholder: "certs/company-ca.pem" } },
				],
			},
		];
	}

	/** Saves through the plugin, so a change to the excluded folders redraws the tree. */
	override async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();
		if (key === "excludedFolders") this.plugin.exclusionsChanged();
	}

	private async setProxyPassword(): Promise<void> {
		const value = await promptText(this.app, "Proxy password", "Leave empty to remove it", "", "Save", true);
		if (value === undefined) return;
		this.app.secretStorage.setSecret(PROXY_SECRET, value);
	}

	private async setPassphrase(): Promise<void> {
		const hosts = parseCertificates(this.plugin.settings.clientCertificates).map((c) => c.host);
		if (hosts.length === 0) {
			new Notice("Add a client certificate first.");
			return;
		}
		const host = hosts.length === 1 ? hosts[0] : await promptText(this.app, "The certificate for which host?", hosts.join(", "), hosts[0], "Next");
		if (!host) return;
		const value = await promptText(this.app, `Passphrase for ${host}`, "Leave empty to remove it", "", "Save", true);
		if (value === undefined) return;
		this.app.secretStorage.setSecret(certificateSecret(host), value);
		void this.plugin.network.reload();
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
		new Setting(containerEl).setName(TEXT.excluded[0]).setDesc(TEXT.excluded[1]).addTextArea((text) =>
			text.setPlaceholder("**/fixtures").setValue(settings.excludedFolders).onChange(async (value) => {
				settings.excludedFolders = value;
				this.plugin.exclusionsChanged();
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

		new Setting(containerEl).setName("Network").setHeading();
		new Setting(containerEl).setName(TEXT.proxy[0]).setDesc(TEXT.proxy[1]).addDropdown((dropdown) =>
			dropdown
				.addOptions(PROXY_OPTIONS)
				.setValue(settings.proxyMode)
				.onChange(async (value) => {
					settings.proxyMode = value as CarbonWireSettings["proxyMode"];
					await this.plugin.saveSettings();
				}),
		);
		new Setting(containerEl).setName(TEXT.proxyUrl[0]).setDesc(TEXT.proxyUrl[1]).addText((text) =>
			text.setValue(settings.proxyUrl).onChange(async (value) => {
				settings.proxyUrl = value.trim();
				await this.plugin.saveSettings();
			}),
		);
		new Setting(containerEl).setName(TEXT.proxyBypass[0]).setDesc(TEXT.proxyBypass[1]).addText((text) =>
			text.setValue(settings.proxyBypass).onChange(async (value) => {
				settings.proxyBypass = value;
				await this.plugin.saveSettings();
			}),
		);
		new Setting(containerEl).setName(TEXT.proxyPassword[0]).setDesc(TEXT.proxyPassword[1]).addButton((button) => button.setButtonText("Set…").onClick(() => void this.setProxyPassword()));
		new Setting(containerEl).setName(TEXT.certificates[0]).setDesc(TEXT.certificates[1]).addTextArea((text) =>
			text.setPlaceholder("api.example.com certs/client.pem certs/client.key").setValue(settings.clientCertificates).onChange(async (value) => {
				settings.clientCertificates = value;
				await this.plugin.saveSettings();
			}),
		);
		new Setting(containerEl).setName(TEXT.passphrase[0]).setDesc(TEXT.passphrase[1]).addButton((button) => button.setButtonText("Set…").onClick(() => void this.setPassphrase()));
		new Setting(containerEl).setName(TEXT.ca[0]).setDesc(TEXT.ca[1]).addTextArea((text) =>
			text.setPlaceholder("certs/company-ca.pem").setValue(settings.caCertificates).onChange(async (value) => {
				settings.caCertificates = value;
				await this.plugin.saveSettings();
			}),
		);
	}
}
