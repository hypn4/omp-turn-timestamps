import {
	formatToolCardSegments,
	type ToolCardTimings,
} from "./format";

interface ToolCardPatchState {
	timings: Map<string, ToolCardTimings>;
	instanceIds: WeakMap<object, string>;
	patched: WeakSet<object>;
	formatter: (timing: ToolCardTimings) => string[];
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

const STATE_KEY = Symbol.for("omp-turn-timestamps.tool-card-state.v4");
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
		formatter: formatToolCardSegments,
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

function plainWidth(value: string): number {
	return chars(value).length;
}

function hardWrapToken(token: string, width: number): string[] {
	if (width <= 0) return [];
	const parts = chars(token);
	const lines: string[] = [];
	for (let offset = 0; offset < parts.length; offset += width) {
		lines.push(parts.slice(offset, offset + width).join(""));
	}
	return lines;
}

function wrapPlain(value: string, width: number, continuationPrefix = "  "): string[] {
	if (width <= 0 || value.length === 0) return [];
	if (plainWidth(value) <= width) return [value];

	const words = value.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let current = "";

	const pushLongWord = (word: string, continuation: boolean) => {
		const prefix = continuation ? continuationPrefix : "";
		const available = Math.max(1, width - plainWidth(prefix));
		const chunks = hardWrapToken(word, available);
		for (const chunk of chunks) {
			lines.push(`${prefix}${chunk}`);
		}
	};

	for (const word of words) {
		const prefix = lines.length > 0 ? continuationPrefix : "";
		const candidate = current ? `${current} ${word}` : `${prefix}${word}`;
		if (plainWidth(candidate) <= width) {
			current = candidate;
			continue;
		}

		if (current) {
			lines.push(current);
			current = "";
		}

		const nextPrefix = lines.length > 0 ? continuationPrefix : "";
		if (plainWidth(`${nextPrefix}${word}`) <= width) {
			current = `${nextPrefix}${word}`;
		} else {
			pushLongWord(word, lines.length > 0);
		}
	}

	if (current) lines.push(current);
	return lines;
}

function layoutTimingSegments(segments: readonly string[], width: number): string[] {
	if (width <= 0 || segments.length === 0) return [];
	const joined = segments.join(" · ");
	if (plainWidth(joined) <= width) return [joined];

	if (segments.length === 3) {
		const firstTwo = `${segments[0]} · ${segments[1]}`;
		if (plainWidth(firstTwo) <= width && plainWidth(segments[2]!) <= width) {
			return [firstTwo, segments[2]!];
		}
		const lastTwo = `${segments[1]} · ${segments[2]}`;
		if (plainWidth(segments[0]!) <= width && plainWidth(lastTwo) <= width) {
			return [segments[0]!, lastTwo];
		}
	}

	if (segments.length === 2) {
		const both = `${segments[0]} · ${segments[1]}`;
		if (plainWidth(both) <= width) return [both];
	}

	return segments.flatMap(segment => wrapPlain(segment, width));
}

function ansiTimingLines(segments: readonly string[], width: number): string[] {
	const bodyWidth = Math.max(1, width - 2);
	return layoutTimingSegments(segments, bodyWidth).map(line => `${DIM}  ${line}${DIM_RESET}`);
}

function borderedTimingLines(
	segments: readonly string[],
	bottom: string,
	previous: string | undefined,
): string[] | undefined {
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
	const innerWidth = Math.max(1, bottomChars.length - 4);
	return layoutTimingSegments(segments, innerWidth).map(line => {
		const padding = " ".repeat(Math.max(0, innerWidth - plainWidth(line)));
		return `${DIM}${side} ${line}${padding} ${side}${DIM_RESET}`;
	});
}

function appendAnsiTiming(lines: readonly string[], segments: readonly string[], width: number): readonly string[] {
	if (lines.length === 0 || segments.length === 0) return lines;
	const next = [...lines];
	let lastNonBlank = next.length - 1;
	while (lastNonBlank >= 0 && stripAnsi(next[lastNonBlank] ?? "").trim() === "") lastNonBlank--;
	if (lastNonBlank < 0) return lines;

	const bordered = borderedTimingLines(segments, next[lastNonBlank]!, next[lastNonBlank - 1]);
	if (bordered) {
		next.splice(lastNonBlank, 0, ...bordered);
		return next;
	}

	next.splice(lastNonBlank + 1, 0, ...ansiTimingLines(segments, width));
	return next;
}

function nativeTimingRow(summary: string): NativeNodeLike {
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
		const segments = timing ? patchState.formatter(timing) : [];
		if (segments.length === 0) return node;
		const summary = segments.join(" · ");

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
			c: [...(node.c ?? []), nativeTimingRow(summary)],
		};
	};

	constructor.prototype.render = function patchedRender(width: number): readonly string[] {
		const lines = originalRender.call(this, width);
		const timing = timingForInstance(this as unknown as object);
		const segments = timing ? patchState.formatter(timing) : [];
		return segments.length > 0 ? appendAnsiTiming(lines, segments, width) : lines;
	};

	patchState.patched.add(prototype);
}

export function installToolCardTimingPatch(constructor: ToolExecutionConstructor | undefined): void {
	const patchState = state();
	patchState.formatter = formatToolCardSegments;
	if (!constructor) {
		throw new Error("OMP host did not expose ToolExecutionComponent");
	}
	patchToolExecutionDescribe(constructor);
}
