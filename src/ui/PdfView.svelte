<script lang="ts">
	import { loadPdfJs } from "obsidian";
	import { onMount } from "svelte";

	let { data }: { data: Uint8Array } = $props();

	interface Viewport {
		width: number;
		height: number;
	}
	interface PdfPage {
		getViewport(options: { scale: number }): Viewport;
		render(options: { canvasContext: CanvasRenderingContext2D; viewport: Viewport }): { promise: Promise<void>; cancel(): void };
	}
	interface PdfDocument {
		numPages: number;
		getPage(n: number): Promise<PdfPage>;
		destroy(): Promise<void>;
	}
	interface PdfJs {
		getDocument(source: { data: Uint8Array }): { promise: Promise<PdfDocument> };
	}

	const MAX_PAGES = 500;

	let scroller: HTMLDivElement;
	let pagesEl: HTMLDivElement;
	let error = $state<string | undefined>();
	let pageCount = $state(0);

	onMount(() => {
		let cancelled = false;
		let doc: PdfDocument | undefined;
		const observer = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				const canvas = entry.target as HTMLCanvasElement;
				if (entry.isIntersecting) void draw(canvas);
				else release(canvas);
			}
		}, { root: scroller, rootMargin: "100% 0px" });

		const pages = new Map<HTMLCanvasElement, PdfPage>();
		const drawing = new WeakMap<HTMLCanvasElement, { cancel(): void }>();

		/** Pages are drawn when they scroll near the view, at the panel's width and the screen's pixel density. */
		async function draw(canvas: HTMLCanvasElement) {
			const page = pages.get(canvas);
			if (!page || canvas.dataset.drawn) return;
			canvas.dataset.drawn = "1";
			const ratio = window.devicePixelRatio || 1;
			const base = page.getViewport({ scale: 1 });
			const viewport = page.getViewport({ scale: (canvas.clientWidth / base.width) * ratio });
			canvas.width = viewport.width;
			canvas.height = viewport.height;
			const context = canvas.getContext("2d");
			if (!context) return;
			const task = page.render({ canvasContext: context, viewport });
			drawing.set(canvas, task);
			await task.promise.catch(() => undefined);
		}

		/** Pages far from view give their pixels back, so long documents don't hold every page in memory. */
		function release(canvas: HTMLCanvasElement) {
			if (!canvas.dataset.drawn) return;
			drawing.get(canvas)?.cancel();
			delete canvas.dataset.drawn;
			canvas.width = 0;
			canvas.height = 0;
		}

		void (async () => {
			try {
				const pdfjs = (await loadPdfJs()) as PdfJs;
				// PDF.js takes ownership of the buffer, so it gets a copy.
				doc = await pdfjs.getDocument({ data: data.slice() }).promise;
				if (cancelled) return;
				pageCount = doc.numPages;
				for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES) && !cancelled; n++) {
					const page = await doc.getPage(n);
					const { width, height } = page.getViewport({ scale: 1 });
					const canvas = pagesEl.createEl("canvas", { cls: "carbonwire-pdf-page" });
					canvas.style.aspectRatio = `${width} / ${height}`;
					pages.set(canvas, page);
					observer.observe(canvas);
				}
			} catch (e) {
				error = `Couldn't show this PDF: ${e instanceof Error ? e.message : String(e)}`;
			}
		})();

		return () => {
			cancelled = true;
			observer.disconnect();
			void doc?.destroy();
		};
	});
</script>

<div class="carbonwire-pdf" bind:this={scroller}>
	{#if error}
		<div class="carbonwire-muted carbonwire-response-placeholder">{error}</div>
	{:else if pageCount > MAX_PAGES}
		<div class="carbonwire-muted">Showing the first {MAX_PAGES} of {pageCount} pages.</div>
	{/if}
	<div class="carbonwire-pdf-pages" bind:this={pagesEl}></div>
</div>
