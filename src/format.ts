export interface TurnTiming {
	startedAtMs: number;
	completedAtMs: number;
}

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

function formatDate(date: Date): string {
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatTime(date: Date): string {
	return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
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

export function formatTurnTimingLine({ startedAtMs, completedAtMs }: TurnTiming): string {
	const start = new Date(startedAtMs);
	const end = new Date(completedAtMs);
	const startLabel = `${formatDate(start)} ${formatTime(start)}`;
	const endLabel = isSameLocalDate(start, end) ? formatTime(end) : `${formatDate(end)} ${formatTime(end)}`;
	const elapsed = formatDuration(completedAtMs - startedAtMs);

	return `◷ ${startLabel} → ${endLabel} · ${elapsed}`;
}
