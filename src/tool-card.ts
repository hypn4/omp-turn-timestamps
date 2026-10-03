interface ToolCardTiming {
	tool?: string;
	turn?: string;
}

interface ToolCardPatchState {
	timings: Map<string, ToolCardTiming>;
	patched: WeakSet<object>;
}

interface NativeNodeLike {
	k: string;
	p?: Record<string, unknown>;
	c?: readonly unknown[];
	key?: string;
}

interface ToolExecutionPrototype {
	describe(context?: unknown): NativeNodeLike;
}

interface ToolExecutionConstructor {
	prototype: ToolExecutionPrototype;
}

type TextFactory = (content: unknown, props?: Record<string, unknown>) => NativeNodeLike;
type SpanFactory = (text: string, style?: string) => unknown;

const STATE_KEY = Symbol.for("omp-turn-timestamps.tool-card-state.v1");
const MAX_TIMINGS = 4096;

function state(): ToolCardPatchState {
	const host = globalThis as unknown as Record<PropertyKey, unknown>;
	const existing = host[STATE_KEY] as ToolCardPatchState | undefined;
	if (existing) return existing;

	const created: ToolCardPatchState = {
		timings: new Map(),
		patched: new WeakSet(),
	};
	host[STATE_KEY] = created;
	return created;
}

function timingParts(timing: ToolCardTiming): string[] {
	return [timing.tool, timing.turn].filter((value): value is string => Boolean(value));
}

function pruneTimings(timings: Map<string, ToolCardTiming>): void {
	while (timings.size > MAX_TIMINGS) {
		const oldest = timings.keys().next().value;
		if (typeof oldest !== "string") break;
		timings.delete(oldest);
	}
}

export function setToolCardTiming(toolCallId: string, patch: ToolCardTiming): void {
	const timings = state().timings;
	const current = timings.get(toolCallId) ?? {};
	timings.delete(toolCallId);
	timings.set(toolCallId, { ...current, ...patch });
	pruneTimings(timings);
}

export function getToolCardTimingForTests(toolCallId: string): ToolCardTiming | undefined {
	return state().timings.get(toolCallId);
}

export function clearToolCardTimingsForTests(): void {
	state().timings.clear();
}

function toolCallId(node: NativeNodeLike): string | undefined {
	if (node.k !== "tool" && node.k !== "card") return undefined;
	const value = node.p?.key;
	return typeof value === "string" ? value : undefined;
}

export function patchToolExecutionDescribe(
	constructor: ToolExecutionConstructor,
	text: TextFactory,
	span: SpanFactory,
): void {
	const patchState = state();
	const prototype = constructor.prototype as unknown as object;
	if (patchState.patched.has(prototype)) return;

	const original = constructor.prototype.describe;
	constructor.prototype.describe = function patchedDescribe(context?: unknown): NativeNodeLike {
		const node = original.call(this, context);
		const id = toolCallId(node);
		if (!id) return node;

		const timing = patchState.timings.get(id);
		if (!timing) return node;
		const parts = timingParts(timing);
		if (parts.length === 0) return node;

		if (node.k === "tool") {
			const existingMeta = Array.isArray(node.p?.meta) ? node.p.meta : [];
			return {
				...node,
				p: {
					...node.p,
					meta: [...existingMeta, ...parts],
				},
			};
		}

		const timingRow = text(
			parts.map((part, index) => span(index === 0 ? part : ` · ${part}`, "dim")),
			{ wrap: "word", role: "omp.tool.timing" },
		);
		return {
			...node,
			c: [...(node.c ?? []), timingRow],
		};
	};

	patchState.patched.add(prototype);
}

export async function installToolCardTimingPatch(): Promise<void> {
	const [components, tui] = await Promise.all([
		import("@oh-my-pi/pi-coding-agent/modes/components"),
		import("@oh-my-pi/pi-tui"),
	]);
	patchToolExecutionDescribe(
		components.ToolExecutionComponent as unknown as ToolExecutionConstructor,
		tui.text as unknown as TextFactory,
		tui.span as unknown as SpanFactory,
	);
}
