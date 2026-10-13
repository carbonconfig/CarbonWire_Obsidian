export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatMs(ms: number): string {
	if (ms < 1) return `${ms.toFixed(2)} ms`;
	if (ms < 1000) return `${Math.round(ms)} ms`;
	return `${(ms / 1000).toFixed(2)} s`;
}

export function statusClass(status: number): string {
	if (status >= 500) return "is-server-error";
	if (status >= 400) return "is-client-error";
	if (status >= 300) return "is-redirect";
	return "is-success";
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(time: number): number {
	const d = new Date(time);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/** "Today", "Yesterday" or a short date, for grouping history by day. */
export function dayLabel(time: number, now = Date.now()): string {
	const days = Math.round((startOfDay(now) - startOfDay(time)) / DAY_MS);
	if (days === 0) return "Today";
	if (days === 1) return "Yesterday";
	return new Date(time).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: days > 300 ? "numeric" : undefined });
}

export function formatClock(time: number): string {
	return new Date(time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Time of day for today, otherwise date and time. */
export function formatTime(time: number, now = Date.now()): string {
	return startOfDay(time) === startOfDay(now) ? formatClock(time) : `${dayLabel(time, now)} ${formatClock(time)}`;
}
