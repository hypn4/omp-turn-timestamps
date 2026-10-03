import {
	formatToolCardSummary,
	type Timing,
	type ToolCardTimings,
} from "./format";

interface ToolCardPatchState {
	timings: Map<string, ToolCardTimings>;
	instanceIds: WeakMap<object, string>;
	patched: WeakSet<object>;
	formatter: (timing: ToolCardTimings) => string | undefined;
}

interface NativeNodeLike {
	k: string;
	p?: Record<string, unknown>;
	c?: readonly unknown[];
	key?: string;
}

interface ToolExecutionPrototype {
	describe(context?: unknown): NativeNodeLike;
	render(width: number): readonly string[];
	setExecutionStarted(toolCallId?: string): void;
	updateResult(result: unknown, isPartial?: boolean, toolCallId?: string): void;
}

export interface ToolExecutionConstructor {
	prototype: ToolExecutionPrototype;
}

const STATE_KEY = Symbol.for("omp-turn-timestamps.tool-card-state.v3");
const MAX_TIMINGS = 4096;
const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const DIM = "\x1b[2m";
const DIM_RESET = "\x1b[22m";

function state(): ToolCardPatchState {
	const host = globalThis as unknown as Record<PropertyKey, unknown>;
	const existing = host[STATE_KEY] as ToolCardPatchState | undefined;
	if (existing) return existing;

	const created: ToolCardPatchState = {
		timings: new Map(),
		instanceIds: new WeakMap(),
		patched: new WeakSet(),
		formatter: formatToolCardSummary,
	};
	host[STATE_KEY] = created;
	return created;
}

function pruneTimings(timings: Map<string, ToolCardTimings>): void {
	while (timings.size > MAX_TIMINGS) {
		const oldest = timings.keys().next().value;
		if (typeof oldest !== "string") break;
		timings.delete(oldest);
	}
}

export function setToolCardTiming(toolCallId: string, patch: ToolCardTimings): void {
	const timings = state().timings;
	const current = timings.get(toolCallId) ?? {};
	timings.delete(toolCallId);
	timings.set(toolCallId, { ...current, ...patch });
	pruneTimings(timings);
}

export function getToolCardTimingForTests(toolCallId: string): ToolCardTimings | undefined {
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

function stripAnsi(value: string): string {
	return value.replace(ANSI_RE, "");
}

function chars(value: string): string[] {
	return Array.from(value);
}

function truncatePlain(value: string, width: number): string {
	if (width <= 0) return "";
	const parts = chars(value);
	return parts.length <= width ? value : parts.slice(0, width).join("");
}

function ansiTimingLine(summary: string, width: number): string {
	const body = truncatePlain(summary, Math.max(0, width - 2));
	return `${DIM}  ${body}${DIM_RESET}`;
}

function borderedTimingLine(summary: string, bottom: string, previous: string | undefined): string | undefined {
	const plainBottom = stripAnsi(bottom);
	const bottomChars = chars(plainBottom);
	if (bottomChars.length < 4) return undefined;
	const first = bottomChars[0];
	const last = bottomChars[bottomChars.length - 1];
	const isBottomBorder =
		(first === "╰" && last === "╯") ||
		(first === "└" && last === "┘") ||
		(first === "+" && last === "+");
	if (!isBottomBorder) return undefined;

	const previousFirst = previous ? chars(stripAnsi(previous))[0] : undefined;
	const side = previousFirst === "│" || previousFirst === "┃" || previousFirst === "|" ? previousFirst : "│";
	const innerWidth = Math.max(0, bottomChars.length - 4);
	const body = truncatePlain(summary, innerWidth);
	const padding = " ".repeat(Math.max(0, innerWidth - chars(body).length));
	return `${DIM}${side} ${body}${padding} ${side}${DIM_RESET}`;
}

function appendAnsiTiming(lines: readonly string[], summary: string, width: number): readonly string[] {
	if (lines.length === 0) return lines;
	const next = [...lines];
	let lastNonBlank = next.length - 1;
	while (lastNonBlank >= 0 && stripAnsi(next[lastNonBlank] ?? "").trim() === "") lastNonBlank--;
	if (lastNonBlank < 0) return lines;

	const bordered = borderedTimingLine(summary, next[lastNonBlank]!, next[lastNonBlank - 1]);
	if (bordered) {
		next.splice(lastNonBlank, 0, bordered);
		return next;
	}

	next.splice(lastNonBlank + 1, 0, ansiTimingLine(summary, width));
	return next;
}

function fallbackTimingRow(summary: string): NativeNodeLike {
	return {
		k: "text",
		p: {
			spans: [{ t: summary, s: "dim" }],
			wrap: "word",
			role: "omp.tool.timing",
		},
	};
}

function timingForInstance(instance: object, node?: NativeNodeLike): ToolCardTimings | undefined {
	const patchState = state();
	const id = patchState.instanceIds.get(instance) ?? (node ? toolCallId(node) : undefined);
	return id ? patchState.timings.get(id) : undefined;
}

export function patchToolExecutionDescribe(constructor: ToolExecutionConstructor): void {
	const patchState = state();
	const prototype = constructor.prototype as unknown as object;
	if (patchState.patched.has(prototype)) return;

	const originalDescribe = constructor.prototype.describe;
	const originalRender = constructor.prototype.render;
	const originalSetExecutionStarted = constructor.prototype.setExecutionStarted;
	const originalUpdateResult = constructor.prototype.updateResult;

	constructor.prototype.setExecutionStarted = function patchedSetExecutionStarted(toolCallId?: string): void {
		if (toolCallId) patchState.instanceIds.set(this as unknown as object, toolCallId);
		originalSetExecutionStarted.call(this, toolCallId);
	};

	constructor.prototype.updateResult = function patchedUpdateResult(
		result: unknown,
		isPartial?: boolean,
		toolCallId?: string,
	): void {
		if (toolCallId) patchState.instanceIds.set(this as unknown as object, toolCallId);
		originalUpdateResult.call(this, result, isPartial, toolCallId);
	};

	constructor.prototype.describe = function patchedDescribe(context?: unknown): NativeNodeLike {
		const node = originalDescribe.call(this, context);
		const id = toolCallId(node);
		if (id) patchState.instanceIds.set(this as unknown as object, id);
		const timing = timingForInstance(this as unknown as object, node);
		const summary = timing ? patchState.formatter(timing) : undefined;
		if (!summary) return node;

		if (node.k === "tool") {
			const existingMeta = Array.isArray(node.p?.meta) ? node.p.meta : [];
			return {
				...node,
				p: {
					...node.p,
					meta: [...existingMeta, summary],
				},
			};
		}

		return {
			...node,
			c: [...(node.c ?? []), fallbackTimingRow(summary)],
		};
	};

	constructor.prototype.render = function patchedRender(width: number): readonly string[] {
		const lines = originalRender.call(this, width);
		const timing = timingForInstance(this as unknown as object);
		const summary = timing ? patchState.formatter(timing) : undefined;
		return summary ? appendAnsiTiming(lines, summary, width) : lines;
	};

	patchState.patched.add(prototype);
}

export function installToolCardTimingPatch(constructor: ToolExecutionConstructor | undefined): void {
	const patchState = state();
	patchState.formatter = formatToolCardSummary;
	if (!constructor) {
		throw new Error("OMP host did not expose ToolExecutionComponent");
	}
	patchToolExecutionDescribe(constructor);
}
