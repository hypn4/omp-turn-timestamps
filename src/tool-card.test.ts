import { describe, expect, test } from "bun:test";
import {
	clearToolCardTimingsForTests,
	patchToolExecutionDescribe,
	setToolCardTiming,
} from "./tool-card";

function makeTiming() {
	return {
		tool: {
			startedAtMs: new Date(2026, 9, 3, 21, 47, 12, 103).getTime(),
			completedAtMs: new Date(2026, 9, 3, 21, 47, 12, 792).getTime(),
		},
		turn: {
			startedAtMs: new Date(2026, 9, 3, 21, 47, 10).getTime(),
			completedAtMs: new Date(2026, 9, 3, 21, 47, 12, 792).getTime(),
		},
	};
}

describe("tool-card renderer patch", () => {
	test("adds one compact timing fact to the native tool card meta", () => {
		clearToolCardTimingsForTests();
		class FakeToolExecution {
			setExecutionStarted() {}
			updateResult() {}
			render() {
				return ["body"];
			}
			describe() {
				return {
					k: "tool",
					p: { key: "call-1", meta: ["existing"] },
				};
			}
		}

		patchToolExecutionDescribe(FakeToolExecution);
		setToolCardTiming("call-1", makeTiming());

		const node = new FakeToolExecution().describe();
		expect(node.p.meta).toEqual([
			"existing",
			"◷ 2026-10-03 · turn 21:47:10–21:47:12 (2.8s) · tool 21:47:12.103–21:47:12.792",
		]);
	});

	test("adds timing inside an ANSI bordered tool component without a separate card", () => {
		clearToolCardTimingsForTests();
		class FakeToolExecution {
			setExecutionStarted() {}
			updateResult() {}
			describe() {
				return { k: "card", p: { key: "call-2" } };
			}
			render() {
				return [
					"╭──────────────────────────────────────────────────────────────────────────────╮",
					"│ output                                                                       │",
					"╰──────────────────────────────────────────────────────────────────────────────╯",
				];
			}
		}

		patchToolExecutionDescribe(FakeToolExecution);
		const component = new FakeToolExecution();
		component.setExecutionStarted("call-2");
		setToolCardTiming("call-2", makeTiming());

		const lines = component.render(80);
		expect(lines).toHaveLength(4);
		expect(lines[2]).toContain("◷ 2026-10-03");
		expect(lines[3]).toContain("╰");
	});

	test("adds a compact timing line below an inline ANSI tool component", () => {
		clearToolCardTimingsForTests();
		class FakeToolExecution {
			setExecutionStarted() {}
			updateResult() {}
			describe() {
				return { k: "card", p: { key: "call-3" } };
			}
			render() {
				return ["Read ~/foo.ts"];
			}
		}

		patchToolExecutionDescribe(FakeToolExecution);
		const component = new FakeToolExecution();
		component.updateResult({}, false, "call-3");
		setToolCardTiming("call-3", { turn: makeTiming().turn });

		const lines = component.render(80);
		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain("◷ turn 2026-10-03");
	});
});
