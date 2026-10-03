import { describe, expect, test } from "bun:test";
import { formatDuration, formatTurnTimingLine } from "./format";

describe("formatDuration", () => {
	test("formats short turns with fractional seconds", () => {
		expect(formatDuration(31_160)).toBe("31.2s");
	});

	test("formats longer turns compactly", () => {
		expect(formatDuration(12 * 60_000 + 41_000)).toBe("12m 41s");
		expect(formatDuration(3_661_000)).toBe("1h 1m 1s");
	});
});

describe("formatTurnTimingLine", () => {
	test("uses a full date once when the turn completes on the same day", () => {
		const startedAtMs = new Date(2026, 9, 3, 20, 31, 14).getTime();
		const completedAtMs = new Date(2026, 9, 3, 20, 43, 55).getTime();

		expect(formatTurnTimingLine({ startedAtMs, completedAtMs })).toBe(
			"◷ 2026-10-03 20:31:14 → 20:43:55 · 12m 41s",
		);
	});

	test("shows both dates when a turn crosses midnight", () => {
		const startedAtMs = new Date(2026, 9, 3, 23, 59, 30).getTime();
		const completedAtMs = new Date(2026, 9, 4, 0, 0, 30).getTime();

		expect(formatTurnTimingLine({ startedAtMs, completedAtMs })).toBe(
			"◷ 2026-10-03 23:59:30 → 2026-10-04 00:00:30 · 1m",
		);
	});
});
