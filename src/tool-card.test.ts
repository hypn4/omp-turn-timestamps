import { describe, expect, test } from "bun:test";
import {
	clearToolCardTimingsForTests,
	patchToolExecutionDescribe,
	setToolCardTiming,
} from "./tool-card";

const text = (content: unknown, props?: Record<string, unknown>) => ({
	k: "text",
	p: { content, ...props },
});
const span = (value: string, style?: string) => ({ t: value, s: style });

describe("tool-card renderer patch", () => {
	test("adds timing to the native tool card meta", () => {
		clearToolCardTimingsForTests();
		class FakeToolExecution {
			describe() {
				return {
					k: "tool",
					p: { key: "call-1", meta: ["existing"] },
				};
			}
		}

		patchToolExecutionDescribe(FakeToolExecution, text, span);
		setToolCardTiming("call-1", {
			tool: "2026-10-03 21:47:12.103 → 21:47:12.792",
			turn: "turn 2026-10-03 21:47:12 → 21:47:15 · 3.2s",
		});

		const node = new FakeToolExecution().describe();
		expect(node.p.meta).toEqual([
			"existing",
			"2026-10-03 21:47:12.103 → 21:47:12.792",
			"turn 2026-10-03 21:47:12 → 21:47:15 · 3.2s",
		]);
	});

	test("adds a dim timing row inside fallback cards", () => {
		clearToolCardTimingsForTests();
		class FakeToolExecution {
			describe() {
				return {
					k: "card",
					p: { key: "call-2" },
					c: [{ k: "text", p: { text: "body" } }],
				};
			}
		}

		patchToolExecutionDescribe(FakeToolExecution, text, span);
		setToolCardTiming("call-2", { tool: "21:47:12.103 → 21:47:12.792" });

		const node = new FakeToolExecution().describe();
		expect(node.c).toHaveLength(2);
		expect(node.c[1].p.role).toBe("omp.tool.timing");
	});
});
