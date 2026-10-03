import { describe, expect, test } from "bun:test";
import {
	formatDuration,
	formatToolCardSummary,
	formatToolCardTiming,
	formatToolTimingLine,
	formatTurnCardTiming,
	formatTurnTimingLine,
} from "./format";

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
			"◷ turn 2026-10-03 20:31:14 → 20:43:55 · 12m 41s",
		);
	});

	test("shows both dates when a turn crosses midnight", () => {
		const startedAtMs = new Date(2026, 9, 3, 23, 59, 30).getTime();
		const completedAtMs = new Date(2026, 9, 4, 0, 0, 30).getTime();

		expect(formatTurnTimingLine({ startedAtMs, completedAtMs })).toBe(
			"◷ turn 2026-10-03 23:59:30 → 2026-10-04 00:00:30 · 1m",
		);
	});
});

describe("formatToolTimingLine", () => {
	test("keeps millisecond clock precision for short tool calls", () => {
		const startedAtMs = new Date(2026, 9, 3, 21, 47, 12, 103).getTime();
		const completedAtMs = new Date(2026, 9, 3, 21, 47, 12, 792).getTime();

		expect(formatToolTimingLine({ toolName: "bash", startedAtMs, completedAtMs })).toBe(
			"◷ tool bash 2026-10-03 21:47:12.103 → 21:47:12.792 · 689ms",
		);
	});
});

describe("tool card formatting", () => {
	test("omits duplicate elapsed time from per-tool card metadata", () => {
		const startedAtMs = new Date(2026, 9, 3, 21, 47, 12, 103).getTime();
		const completedAtMs = new Date(2026, 9, 3, 21, 47, 12, 792).getTime();
		expect(formatToolCardTiming({ startedAtMs, completedAtMs })).toBe(
			"2026-10-03 21:47:12.103–21:47:12.792",
		);
	});

	test("keeps the turn duration because it is distinct from the tool wall time", () => {
		const startedAtMs = new Date(2026, 9, 3, 21, 47, 12).getTime();
		const completedAtMs = new Date(2026, 9, 3, 21, 47, 15, 200).getTime();
		expect(formatTurnCardTiming({ startedAtMs, completedAtMs })).toBe(
			"turn 2026-10-03 21:47:12–21:47:15 (3.2s)",
		);
	});

	test("combines same-day tool and turn timing into one non-redundant line", () => {
		const tool = {
			startedAtMs: new Date(2026, 9, 3, 21, 47, 12, 103).getTime(),
			completedAtMs: new Date(2026, 9, 3, 21, 47, 12, 792).getTime(),
		};
		const turn = {
			startedAtMs: new Date(2026, 9, 3, 21, 47, 10).getTime(),
			completedAtMs: new Date(2026, 9, 3, 21, 47, 12, 792).getTime(),
		};
		expect(formatToolCardSummary({ tool, turn })).toBe(
			"◷ 2026-10-03 · turn 21:47:10–21:47:12 (2.8s) · tool 21:47:12.103–21:47:12.792",
		);
	});
});
