import { describe, expect, test } from "bun:test";
import {
	createTurnTimestampsExtension,
	type TimingSettings,
} from "./index";
import {
	clearToolCardTimingsForTests,
	getToolCardTimingForTests,
} from "./tool-card";

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
		pi: { ToolExecutionComponent: undefined },
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		sendMessage: (message: any, options: any) => sent.push({ message, options }),
		appendEntry: (customType: string, data: any) => entries.push({ customType, data }),
		logger: {
			warn: (...args: unknown[]) => warnings.push(args),
		},
	};

	createTurnTimestampsExtension(async () => resolvedSettings)(
		pi as Parameters<ReturnType<typeof createTurnTimestampsExtension>>[0],
	);

	return { handlers, sent, entries, warnings };
}

const ctx = { cwd: "/tmp", mode: "rpc" };

function assistantWithTools(...ids: string[]) {
	return {
		role: "assistant",
		content: ids.map(id => ({ type: "toolCall", id, name: "bash", arguments: {} })),
		stopReason: "toolUse",
	};
}

describe("turn timestamps extension", () => {
	test("stores tool and turn timing for the existing tool card", async () => {
		clearToolCardTimingsForTests();
		const originalNow = Date.now;
		const start = new Date(2026, 9, 3, 21, 47, 12, 0).getTime();
		let now = start;
		Date.now = () => now;

		try {
			const { handlers, sent, entries } = createHarness({ showToolTiming: true });
			await handlers.get("turn_start")?.({ type: "turn_start", turnIndex: 3, timestamp: start }, ctx);
			await handlers.get("message_end")?.(
				{ type: "message_end", message: assistantWithTools("call-1") },
				ctx,
			);

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

			expect(getToolCardTimingForTests("call-1")).toEqual({
				tool: { startedAtMs: start + 103, completedAtMs: start + 792 },
				turn: { startedAtMs: start, completedAtMs: start + 792 },
			});

			now = start + 800;
			await handlers.get("turn_end")?.(
				{ type: "turn_end", turnIndex: 3, message: {}, toolResults: [] },
				ctx,
			);

			expect(getToolCardTimingForTests("call-1")?.turn).toEqual({
				startedAtMs: start,
				completedAtMs: start + 792,
			});
			expect(sent).toHaveLength(0);
			expect(entries.map(entry => entry.customType)).toEqual([
				"omp-turn-timestamps.tool",
				"omp-turn-timestamps.turn",
			]);
			expect(entries[1]?.data.displayToolCallId).toBe("call-1");
		} finally {
			Date.now = originalNow;
		}
	});

	test("puts the turn timing on the last completed tool card", async () => {
		clearToolCardTimingsForTests();
		const originalNow = Date.now;
		const start = new Date(2026, 9, 3, 21, 50, 0).getTime();
		let now = start;
		Date.now = () => now;

		try {
			const { handlers } = createHarness({ showToolTiming: true });
			await handlers.get("turn_start")?.({ type: "turn_start", turnIndex: 1, timestamp: start }, ctx);
			await handlers.get("message_end")?.(
				{ type: "message_end", message: assistantWithTools("call-a", "call-b") },
				ctx,
			);

			now += 10;
			await handlers.get("tool_call")?.({ type: "tool_call", toolCallId: "call-a", toolName: "read", input: {} }, ctx);
			now += 10;
			await handlers.get("tool_call")?.({ type: "tool_call", toolCallId: "call-b", toolName: "grep", input: {} }, ctx);

			now += 30;
			await handlers.get("tool_result")?.({
				type: "tool_result",
				toolCallId: "call-a",
				toolName: "read",
				input: {},
				content: [],
				isError: false,
			});
			expect(getToolCardTimingForTests("call-a")?.tool).toEqual({
				startedAtMs: start + 10,
				completedAtMs: start + 50,
			});
			expect(getToolCardTimingForTests("call-a")?.turn).toBeUndefined();

			now += 50;
			await handlers.get("tool_result")?.({
				type: "tool_result",
				toolCallId: "call-b",
				toolName: "grep",
				input: {},
				content: [],
				isError: false,
			});
			expect(getToolCardTimingForTests("call-b")?.tool).toEqual({
				startedAtMs: start + 20,
				completedAtMs: start + 100,
			});
			expect(getToolCardTimingForTests("call-b")?.turn).toEqual({
				startedAtMs: start,
				completedAtMs: start + 100,
			});
		} finally {
			Date.now = originalNow;
		}
	});

	test("keeps per-tool timing disabled by default while attaching turn timing", async () => {
		clearToolCardTimingsForTests();
		const originalNow = Date.now;
		const start = new Date(2026, 9, 3, 22, 0, 0).getTime();
		let now = start;
		Date.now = () => now;

		try {
			const { handlers, entries } = createHarness();
			await handlers.get("turn_start")?.({ type: "turn_start", turnIndex: 0, timestamp: start }, ctx);
			await handlers.get("message_end")?.(
				{ type: "message_end", message: assistantWithTools("call") },
				ctx,
			);
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

			const timing = getToolCardTimingForTests("call");
			expect(timing?.tool).toBeUndefined();
			expect(timing?.turn).toEqual({
				startedAtMs: start,
				completedAtMs: start + 1_500,
			});
			expect(entries.some(entry => entry.customType === "omp-turn-timestamps.tool")).toBe(false);
		} finally {
			Date.now = originalNow;
		}
	});

	test("can show tool timing while hiding turn timing", async () => {
		clearToolCardTimingsForTests();
		const originalNow = Date.now;
		const start = new Date(2026, 9, 3, 22, 5, 0).getTime();
		let now = start;
		Date.now = () => now;

		try {
			const { handlers } = createHarness({ showTurnTiming: false, showToolTiming: true });
			await handlers.get("turn_start")?.({ type: "turn_start", turnIndex: 2, timestamp: start }, ctx);
			await handlers.get("message_end")?.(
				{ type: "message_end", message: assistantWithTools("call") },
				ctx,
			);
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

			expect(getToolCardTimingForTests("call")).toEqual({
				tool: { startedAtMs: start + 50, completedAtMs: start + 150 },
			});
		} finally {
			Date.now = originalNow;
		}
	});

	test("uses a custom card only when a turn has no tool card to attach to", async () => {
		clearToolCardTimingsForTests();
		const originalNow = Date.now;
		const start = new Date(2026, 9, 3, 22, 10, 0).getTime();
		let now = start;
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
			expect(sent[0]?.message.customType).toBe("omp-turn-timestamp");
			expect(sent[0]?.message.content).toBe(
				"◷ turn 2026-10-03 22:10:00 → 22:10:02 · 2s",
			);
		} finally {
			Date.now = originalNow;
		}
	});

	test("hydrates in-card timing from structured session metadata", async () => {
		clearToolCardTimingsForTests();
		const { handlers } = createHarness();
		const toolStart = Date.parse("2026-10-03T12:00:00.100Z");
		const toolEnd = Date.parse("2026-10-03T12:00:00.600Z");
		const turnStart = Date.parse("2026-10-03T12:00:00.000Z");
		const turnEnd = Date.parse("2026-10-03T12:00:01.000Z");
		const branch = [
			{
				type: "custom",
				customType: "omp-turn-timestamps.tool",
				data: {
					turnIndex: 1,
					toolCallId: "restored",
					toolName: "bash",
					startedAt: "2026-10-03T12:00:00.100Z",
					completedAt: "2026-10-03T12:00:00.600Z",
					elapsedMs: 500,
				},
			},
			{
				type: "custom",
				customType: "omp-turn-timestamps.turn",
				data: {
					turnIndex: 1,
					startedAt: "2026-10-03T12:00:00.000Z",
					completedAt: "2026-10-03T12:00:01.000Z",
					elapsedMs: 1000,
					displayToolCallId: "restored",
				},
			},
		];

		await handlers.get("session_start")?.(
			{ type: "session_start" },
			{ mode: "rpc", sessionManager: { getBranch: () => branch } },
		);

		expect(getToolCardTimingForTests("restored")).toEqual({
			tool: { startedAtMs: toolStart, completedAtMs: toolEnd },
			turn: { startedAtMs: turnStart, completedAtMs: turnEnd },
		});
	});

	test("removes the no-tool fallback card from provider context", async () => {
		const { handlers } = createHarness();
		const userMessage = { role: "user", content: "hello", timestamp: 1 };
		const breadcrumb = {
			role: "custom",
			customType: "omp-turn-timestamp",
			content: "timing",
			display: true,
			timestamp: 2,
		};
		const otherCustom = {
			role: "custom",
			customType: "other-extension",
			content: "keep",
			display: true,
			timestamp: 3,
		};

		const result = await handlers.get("context")?.({
			type: "context",
			messages: [userMessage, breadcrumb, otherCustom],
		});

		expect(result.messages).toEqual([userMessage, otherCustom]);
	});
});
