import { describe, expect, test } from "bun:test";
import {
	createTurnTimestampsExtension,
	type TimingSettings,
} from "./index";

type Handler = (event: any, context?: any) => Promise<any> | any;

function createHarness(settings: Partial<TimingSettings> = {}) {
	const handlers = new Map<string, Handler>();
	const sent: Array<{ message: any; options: any }> = [];
	const entries: Array<{ customType: string; data: any }> = [];
	const warnings: unknown[] = [];
	const resolvedSettings: TimingSettings = {
		showTurnTiming: settings.showTurnTiming ?? true,
		showToolTiming: settings.showToolTiming ?? false,
	};

	const pi = {
		setLabel: () => {},
		on: (event: string, handler: Handler) => {
			handlers.set(event, handler);
		},
		sendMessage: (message: any, options: any) => {
			sent.push({ message, options });
		},
		appendEntry: (customType: string, data: any) => {
			entries.push({ customType, data });
		},
		logger: {
			warn: (...args: unknown[]) => warnings.push(args),
		},
	};

	createTurnTimestampsExtension(async () => resolvedSettings)(
		pi as Parameters<ReturnType<typeof createTurnTimestampsExtension>>[0],
	);

	return { handlers, sent, entries, warnings };
}

const ctx = { cwd: "/tmp" };

describe("turn timestamps extension", () => {
	test("renders tool_call-to-tool_result timing and turn timing as separate passive cards", async () => {
		const originalNow = Date.now;
		const start = new Date(2026, 9, 3, 21, 47, 12, 0).getTime();
		let now = start;
		Date.now = () => now;

		try {
			const { handlers, sent, entries } = createHarness({ showToolTiming: true });
			await handlers.get("turn_start")?.({ type: "turn_start", turnIndex: 3, timestamp: start }, ctx);

			now = start + 103;
			await handlers.get("tool_call")?.(
				{ type: "tool_call", toolCallId: "call-1", toolName: "bash", input: {} },
				ctx,
			);

			now = start + 792;
			await handlers.get("tool_result")?.(
				{
					type: "tool_result",
					toolCallId: "call-1",
					toolName: "bash",
					input: {},
					content: [{ type: "text", text: "output" }],
					isError: false,
				},
				ctx,
			);

			expect(sent).toHaveLength(1);
			expect(sent[0]?.options).toEqual({ triggerTurn: false, deliverAs: "aside" });
			expect(sent[0]?.message.customType).toBe("omp-tool-timestamp");
			expect(sent[0]?.message.content).toBe(
				"◷ tool bash 2026-10-03 21:47:12.103 → 21:47:12.792 · 689ms",
			);
			expect(sent[0]?.message.details.elapsedMs).toBe(689);

			now = start + 800;
			await handlers.get("turn_end")?.(
				{
					type: "turn_end",
					turnIndex: 3,
					message: {},
					toolResults: [{ toolName: "bash", isError: false }],
				},
				ctx,
			);

			expect(sent).toHaveLength(2);
			expect(sent[1]?.options).toEqual({ triggerTurn: false, deliverAs: "aside" });
			expect(sent[1]?.message.customType).toBe("omp-turn-timestamp");
			expect(sent[1]?.message.content).toBe(
				"◷ turn 2026-10-03 21:47:12 → 21:47:12 · 800ms",
			);

			expect(entries.map(entry => entry.customType)).toEqual([
				"omp-turn-timestamps.tool",
				"omp-turn-timestamps.turn",
			]);
			expect(entries[0]?.data.elapsedMs).toBe(689);
			expect(entries[1]?.data.elapsedMs).toBe(800);
		} finally {
			Date.now = originalNow;
		}
	});

	test("emits one optional card per completed tool in a multi-tool turn", async () => {
		const originalNow = Date.now;
		const start = new Date(2026, 9, 3, 21, 50, 0).getTime();
		let now = start;
		Date.now = () => now;

		try {
			const { handlers, sent } = createHarness({ showToolTiming: true });
			await handlers.get("turn_start")?.({ type: "turn_start", turnIndex: 1, timestamp: start }, ctx);

			now += 10;
			await handlers.get("tool_call")?.({ type: "tool_call", toolCallId: "a", toolName: "read", input: {} }, ctx);
			now += 10;
			await handlers.get("tool_call")?.({ type: "tool_call", toolCallId: "b", toolName: "grep", input: {} }, ctx);

			now += 30;
			await handlers.get("tool_result")?.({
				type: "tool_result",
				toolCallId: "a",
				toolName: "read",
				input: {},
				content: [],
				isError: false,
			});
			now += 50;
			await handlers.get("tool_result")?.({
				type: "tool_result",
				toolCallId: "b",
				toolName: "grep",
				input: {},
				content: [],
				isError: false,
			});

			now += 5;
			await handlers.get("turn_end")?.({
				type: "turn_end",
				turnIndex: 1,
				message: {},
				toolResults: [
					{ toolName: "read", isError: false },
					{ toolName: "grep", isError: false },
				],
			});

			expect(sent).toHaveLength(3);
			expect(sent.map(item => item.message.customType)).toEqual([
				"omp-tool-timestamp",
				"omp-tool-timestamp",
				"omp-turn-timestamp",
			]);
			expect(sent[0]?.message.content).toContain("◷ tool read");
			expect(sent[1]?.message.content).toContain("◷ tool grep");
			expect(sent[2]?.message.content).toContain("◷ turn");
		} finally {
			Date.now = originalNow;
		}
	});

	test("keeps per-tool timing disabled by default while turn timing stays enabled", async () => {
		const originalNow = Date.now;
		let now = new Date(2026, 9, 3, 22, 0, 0).getTime();
		const start = now;
		Date.now = () => now;

		try {
			const { handlers, sent, entries } = createHarness();
			await handlers.get("turn_start")?.({ type: "turn_start", turnIndex: 0, timestamp: start }, ctx);
			await handlers.get("tool_call")?.({ type: "tool_call", toolCallId: "call", toolName: "bash", input: {} }, ctx);
			now += 1_500;
			await handlers.get("tool_result")?.({
				type: "tool_result",
				toolCallId: "call",
				toolName: "bash",
				input: {},
				content: [],
				isError: false,
			});
			expect(sent).toHaveLength(0);

			await handlers.get("turn_end")?.({
				type: "turn_end",
				turnIndex: 0,
				message: {},
				toolResults: [{ toolName: "bash", isError: false }],
			});

			expect(sent).toHaveLength(1);
			expect(sent[0]?.message.customType).toBe("omp-turn-timestamp");
			expect(entries.some(entry => entry.customType === "omp-turn-timestamps.tool")).toBe(false);
		} finally {
			Date.now = originalNow;
		}
	});

	test("can show tool timing while hiding turn timing", async () => {
		const originalNow = Date.now;
		let now = new Date(2026, 9, 3, 22, 5, 0).getTime();
		const start = now;
		Date.now = () => now;

		try {
			const { handlers, sent } = createHarness({ showTurnTiming: false, showToolTiming: true });
			await handlers.get("turn_start")?.({ type: "turn_start", turnIndex: 2, timestamp: start }, ctx);
			now += 50;
			await handlers.get("tool_call")?.({ type: "tool_call", toolCallId: "call", toolName: "read", input: {} }, ctx);
			now += 100;
			await handlers.get("tool_result")?.({
				type: "tool_result",
				toolCallId: "call",
				toolName: "read",
				input: {},
				content: [],
				isError: false,
			});
			await handlers.get("turn_end")?.({
				type: "turn_end",
				turnIndex: 2,
				message: {},
				toolResults: [{ toolName: "read", isError: false }],
			});

			expect(sent).toHaveLength(1);
			expect(sent[0]?.message.customType).toBe("omp-tool-timestamp");
			expect(sent[0]?.message.content).toContain("◷ tool read");
		} finally {
			Date.now = originalNow;
		}
	});

	test("defers a no-tool terminal turn until agent_end", async () => {
		const originalNow = Date.now;
		let now = new Date(2026, 9, 3, 22, 10, 0).getTime();
		const start = now;
		Date.now = () => now;

		try {
			const { handlers, sent } = createHarness();
			await handlers.get("turn_start")?.({ type: "turn_start", turnIndex: 4, timestamp: start }, ctx);
			now += 2_000;
			await handlers.get("turn_end")?.(
				{ type: "turn_end", turnIndex: 4, message: {}, toolResults: [] },
				ctx,
			);
			expect(sent).toHaveLength(0);

			await handlers.get("agent_end")?.({ type: "agent_end", messages: [] }, ctx);
			expect(sent).toHaveLength(1);
			expect(sent[0]?.options).toEqual({ triggerTurn: false });
			expect(sent[0]?.message.content).toBe(
				"◷ turn 2026-10-03 22:10:00 → 22:10:02 · 2s",
			);
		} finally {
			Date.now = originalNow;
		}
	});

	test("defers both yield tool and turn cards to avoid a synthetic continuation", async () => {
		const originalNow = Date.now;
		let now = new Date(2026, 9, 3, 22, 20, 0).getTime();
		const start = now;
		Date.now = () => now;

		try {
			const { handlers, sent } = createHarness({ showToolTiming: true });
			await handlers.get("turn_start")?.({ type: "turn_start", turnIndex: 5, timestamp: start }, ctx);
			await handlers.get("tool_call")?.({ type: "tool_call", toolCallId: "yield-1", toolName: "yield", input: {} }, ctx);
			now += 250;
			await handlers.get("tool_result")?.({
				type: "tool_result",
				toolCallId: "yield-1",
				toolName: "yield",
				input: {},
				content: [],
				isError: false,
			});
			expect(sent).toHaveLength(0);

			await handlers.get("turn_end")?.({
				type: "turn_end",
				turnIndex: 5,
				message: {},
				toolResults: [{ toolName: "yield", isError: false }],
			});
			expect(sent).toHaveLength(0);

			await handlers.get("agent_end")?.({ type: "agent_end", messages: [] }, ctx);
			expect(sent).toHaveLength(2);
			expect(sent.map(item => item.options)).toEqual([
				{ triggerTurn: false },
				{ triggerTurn: false },
			]);
			expect(sent[0]?.message.customType).toBe("omp-tool-timestamp");
			expect(sent[1]?.message.customType).toBe("omp-turn-timestamp");
		} finally {
			Date.now = originalNow;
		}
	});

	test("removes turn and tool timing cards from provider context", async () => {
		const { handlers } = createHarness();
		const userMessage = { role: "user", content: "hello", timestamp: 1 };
		const turnCard = {
			role: "custom",
			customType: "omp-turn-timestamp",
			content: "turn timing",
			display: true,
			timestamp: 2,
		};
		const toolCard = {
			role: "custom",
			customType: "omp-tool-timestamp",
			content: "tool timing",
			display: true,
			timestamp: 3,
		};
		const otherCustom = {
			role: "custom",
			customType: "other-extension",
			content: "keep",
			display: true,
			timestamp: 4,
		};

		const result = await handlers.get("context")?.({
			type: "context",
			messages: [userMessage, turnCard, toolCard, otherCustom],
		});

		expect(result.messages).toEqual([userMessage, otherCustom]);
	});
});
