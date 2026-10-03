export interface Timing {
	startedAtMs: number;
	completedAtMs: number;
}

export interface ToolTiming extends Timing {
	toolName: string;
}

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

function formatDate(date: Date): string {
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatTime(date: Date, includeMilliseconds = false): string {
	const base = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
	return includeMilliseconds ? `${base}.${String(date.getMilliseconds()).padStart(3, "0")}` : base;
}

function isSameLocalDate(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

export function formatDuration(elapsedMs: number): string {
	const safeMs = Math.max(0, elapsedMs);

	if (safeMs < 1_000) {
		return `${Math.round(safeMs)}ms`;
	}

	if (safeMs < 60_000) {
		return `${(safeMs / 1_000).toFixed(1).replace(/\.0$/, "")}s`;
	}

	let remainingSeconds = Math.round(safeMs / 1_000);
	const days = Math.floor(remainingSeconds / 86_400);
	remainingSeconds %= 86_400;
	const hours = Math.floor(remainingSeconds / 3_600);
	remainingSeconds %= 3_600;
	const minutes = Math.floor(remainingSeconds / 60);
	const seconds = remainingSeconds % 60;

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
	return parts.join(" ");
}

export function formatTimingRange({ startedAtMs, completedAtMs }: Timing, includeMilliseconds = false): string {
	const start = new Date(startedAtMs);
	const end = new Date(completedAtMs);
	const startLabel = `${formatDate(start)} ${formatTime(start, includeMilliseconds)}`;
	const endLabel = isSameLocalDate(start, end)
		? formatTime(end, includeMilliseconds)
		: `${formatDate(end)} ${formatTime(end, includeMilliseconds)}`;
	return `${startLabel} → ${endLabel} · ${formatDuration(completedAtMs - startedAtMs)}`;
}

export function formatToolCardTiming(timing: Timing): string {
	const range = formatTimingRange(timing, true);
	const separator = range.lastIndexOf(" · ");
	return separator === -1 ? range : range.slice(0, separator);
}

export function formatTurnCardTiming(timing: Timing): string {
	return `turn ${formatTimingRange(timing)}`;
}

export function formatTurnTimingLine(timing: Timing): string {
	return `◷ turn ${formatTimingRange(timing)}`;
}

export function formatToolTimingLine({ toolName, ...timing }: ToolTiming): string {
	return `◷ tool ${toolName} ${formatTimingRange(timing, true)}`;
}
