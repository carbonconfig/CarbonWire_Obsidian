import { ItemView, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type CarbonWirePlugin from "../main";
import ConsolePanel from "./ConsolePanel.svelte";
import CookieManager from "./CookieManager.svelte";
import type { ConsoleEntry } from "./types";

export const VIEW_TYPE_CONSOLE = "carbonwire-console";
export const VIEW_TYPE_COOKIES = "carbonwire-cookies";

/** The console: the last sends as they went out, kept in memory only. */
export class ConsoleView extends ItemView {
	private panel?: { add(entry: ConsoleEntry): void; clear(): void } & Record<string, unknown>;
	private stop?: () => void;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: CarbonWirePlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_CONSOLE;
	}

	getDisplayText(): string {
		return "CarbonWire console";
	}

	override getIcon(): string {
		return "terminal";
	}

	override async onOpen(): Promise<void> {
		const { plugin } = this;
		this.panel = mount(ConsolePanel, {
			target: this.contentEl,
			props: { initial: [...plugin.console], onClear: () => plugin.clearConsole(), onCopy: (text: string) => void navigator.clipboard.writeText(text) },
		}) as typeof this.panel;
		this.stop = plugin.onConsole((entry) => (entry ? this.panel?.add(entry) : this.panel?.clear()));
	}

	override async onClose(): Promise<void> {
		this.stop?.();
		if (this.panel) await unmount(this.panel);
		this.panel = undefined;
	}
}

/** The cookie manager: the jar's cookies by domain, to delete or add. */
export class CookiesView extends ItemView {
	private manager?: Record<string, unknown> & { setCookies(cookies: unknown[]): void };
	private stop?: () => void;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: CarbonWirePlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_COOKIES;
	}

	getDisplayText(): string {
		return "Cookies";
	}

	override getIcon(): string {
		return "cookie";
	}

	override async onOpen(): Promise<void> {
		const jar = await this.plugin.network.cookieJar();
		this.manager = mount(CookieManager, {
			target: this.contentEl,
			props: {
				initial: jar.all(),
				onDelete: (domain: string | undefined, name?: string, path?: string) =>
					void jar.delete((c) => (domain === undefined || c.domain === domain) && (name === undefined || c.name === name) && (path === undefined || c.path === path)),
				onAdd: async (url: string, setCookie: string) => {
					let target: URL;
					try {
						target = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
					} catch {
						return "Enter the URL the cookie is for, such as https://api.example.com/.";
					}
					return jar.set(target, setCookie) ? undefined : "That cookie can't be set for this URL. Check its Domain.";
				},
			},
		}) as typeof this.manager;
		this.stop = this.plugin.network.onCookiesChanged(() => this.manager?.setCookies(jar.all()));
	}

	override async onClose(): Promise<void> {
		this.stop?.();
		if (this.manager) await unmount(this.manager);
		this.manager = undefined;
	}
}
