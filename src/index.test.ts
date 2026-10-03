import { describe, expect, test } from "bun:test";
import turnTimestamps from "./index";

type Handler = (event: any, context?: any) => Promise<any> | any;

function createHarness() {
	const handlers = new Map<string, Handler>();
	const sent: Array<{ message: any; options: any }> = [];
	const warnings: unknown[] = [];

	const pi = {
		setLabel: () => {},
		on: (event: string, handler: Handler) => {
			handlers.set(event, handler);
		},
		sendMessage: (message: any, options: any) => {
			sent.push({ message, options });
		},
		logger: {
			warn: (...args: unknown[]) => warnings.push(args),
		},
	};

	turnTimestamps(pi as Parameters<typeof turnTimestamps>[0]);
	return { handlers, sent, warnings };
}

describe("turn timestamps extension", () => {
	test("records one settled agent loop and preserves automatic continuations", async () => {
		const originalNow = Date.now;
		let now = new Date(2026, 9, 3, 20, 31, 14).getTime();
		Date.now = () => now;

		try {
			const { handlers, sent } = createHarness();
			await handlers.get("agent_start")?.({ type: "agent_start" });

			now += 30_000;
			await handlers.get("agent_end")?.({ type: "agent_end", messages: [], willContinue: true });
			expect(sent).toHaveLength(0);

			now += 11_000;
			await handlers.get("agent_end")?.({ type: "agent_end", messages: [] });

			expect(sent).toHaveLength(1);
			expect(sent[0]?.options).toEqual({ triggerTurn: false });
			expect(sent[0]?.message.customType).toBe("omp-turn-timestamp");
			expect(sent[0]?.message.display).toBe(true);
			expect(sent[0]?.message.content).toBe(
				"◷ 2026-10-03 20:31:14 → 20:31:55 · 41s",
			);
			expect(sent[0]?.message.details.elapsedMs).toBe(41_000);
		} finally {
			Date.now = originalNow;
		}
	});

	test("removes only its own transcript breadcrumbs from model context", async () => {
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

		expect(result?.messages).toEqual([userMessage, otherCustom]);
	});
});
