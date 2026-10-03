export interface Timing {
	startedAtMs: number;
	completedAtMs: number;
}

export interface ToolTiming extends Timing {
	toolName: string;
}

export interface ToolCardTimings {
	tool?: Timing;
	turn?: Timing;
}

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

function pad3(value: number): string {
	return String(value).padStart(3, "0");
}

function formatDate(date: Date): string {
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatTime(date: Date, includeMilliseconds = false): string {
	const base = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
	return includeMilliseconds ? `${base}.${pad3(date.getMilliseconds())}` : base;
}

function isSameLocalDate(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

function isSameTimingDate(a: Timing, b: Timing): boolean {
	const aStart = new Date(a.startedAtMs);
	const aEnd = new Date(a.completedAtMs);
	const bStart = new Date(b.startedAtMs);
	const bEnd = new Date(b.completedAtMs);
	return (
		isSameLocalDate(aStart, aEnd) &&
		isSameLocalDate(bStart, bEnd) &&
		isSameLocalDate(aStart, bStart)
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

export function formatToolCardTiming({ startedAtMs, completedAtMs }: Timing): string {
	const start = new Date(startedAtMs);
	const end = new Date(completedAtMs);
	const endLabel = isSameLocalDate(start, end)
		? formatTime(end, true)
		: `${formatDate(end)} ${formatTime(end, true)}`;
	return `${formatDate(start)} ${formatTime(start, true)}–${endLabel}`;
}

export function formatTurnCardTiming({ startedAtMs, completedAtMs }: Timing): string {
	const start = new Date(startedAtMs);
	const end = new Date(completedAtMs);
	const endLabel = isSameLocalDate(start, end)
		? formatTime(end)
		: `${formatDate(end)} ${formatTime(end)}`;
	return `turn ${formatDate(start)} ${formatTime(start)}–${endLabel} (${formatDuration(completedAtMs - startedAtMs)})`;
}

export function formatToolCardSummary({ tool, turn }: ToolCardTimings): string | undefined {
	if (tool && turn && isSameTimingDate(tool, turn)) {
		const date = formatDate(new Date(tool.startedAtMs));
		return [
			`◷ ${date}`,
			`turn ${formatTime(new Date(turn.startedAtMs))}–${formatTime(new Date(turn.completedAtMs))} (${formatDuration(turn.completedAtMs - turn.startedAtMs)})`,
			`tool ${formatTime(new Date(tool.startedAtMs), true)}–${formatTime(new Date(tool.completedAtMs), true)}`,
		].join(" · ");
	}
	if (tool && turn) return `◷ ${formatTurnCardTiming(turn)} · tool ${formatToolCardTiming(tool)}`;
	if (tool) return `◷ ${formatDate(new Date(tool.startedAtMs))} · tool ${formatTime(new Date(tool.startedAtMs), true)}–${formatTime(new Date(tool.completedAtMs), true)}`;
	if (turn) return `◷ ${formatTurnCardTiming(turn)}`;
	return undefined;
}

export function formatTurnTimingLine(timing: Timing): string {
	return `◷ turn ${formatTimingRange(timing)}`;
}

export function formatToolTimingLine({ toolName, ...timing }: ToolTiming): string {
	return `◷ tool ${toolName} ${formatTimingRange(timing, true)}`;
}
