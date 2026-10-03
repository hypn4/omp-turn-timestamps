import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { formatTurnTimingLine, type Timing } from "./format";
import {
	installToolCardTimingPatch,
	setToolCardTiming,
	type ToolExecutionConstructor,
} from "./tool-card";

const PLUGIN_NAME = "omp-turn-timestamps";
const TURN_CUSTOM_TYPE = "omp-turn-timestamp";
const TURN_RECORD_TYPE = "omp-turn-timestamps.turn";
const TOOL_RECORD_TYPE = "omp-turn-timestamps.tool";

export interface TimingSettings {
	showTurnTiming: boolean;
	showToolTiming: boolean;
}

const DEFAULT_SETTINGS: TimingSettings = {
	showTurnTiming: true,
	showToolTiming: false,
};

type SettingsLoader = (cwd: string) => Promise<TimingSettings>;

interface ActiveTurn {
	turnIndex: number;
	startedAtMs: number;
	expectedToolResults: number;
	completedToolResults: number;
	turnTimingAttached: boolean;
	displayToolCallId?: string;
	displayCompletedAtMs?: number;
	settings: TimingSettings;
	settingsReady: Promise<TimingSettings>;
}

interface ToolStart {
	toolName: string;
	startedAtMs: number;
	turnIndex: number;
}

interface TurnTimestampDetails {
	turnIndex: number;
	startedAt: string;
	completedAt: string;
	elapsedMs: number;
	displayToolCallId?: string;
}

interface ToolTimestampDetails extends TurnTimestampDetails {
	toolCallId: string;
	toolName: string;
	isError: boolean;
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

export async function loadTimingSettings(cwd: string): Promise<TimingSettings> {
	const { getPluginSettings } = await import("@oh-my-pi/pi-coding-agent/extensibility/plugins");
	const settings = await getPluginSettings(PLUGIN_NAME, cwd);
	return {
		showTurnTiming: booleanSetting(settings.showTurnTiming, DEFAULT_SETTINGS.showTurnTiming),
		showToolTiming: booleanSetting(settings.showToolTiming, DEFAULT_SETTINGS.showToolTiming),
	};
}

function timingDetails(
	turnIndex: number,
	timing: Timing,
	displayToolCallId?: string,
): TurnTimestampDetails {
	return {
		turnIndex,
		startedAt: new Date(timing.startedAtMs).toISOString(),
		completedAt: new Date(timing.completedAtMs).toISOString(),
		elapsedMs: Math.max(0, timing.completedAtMs - timing.startedAtMs),
		...(displayToolCallId ? { displayToolCallId } : {}),
	};
}

function countToolCalls(message: unknown): number {
	if (typeof message !== "object" || message === null) return 0;
	const candidate = message as { role?: unknown; content?: unknown };
	if (candidate.role !== "assistant" || !Array.isArray(candidate.content)) return 0;
	return candidate.content.filter(
		block =>
			typeof block === "object" &&
			block !== null &&
			(block as { type?: unknown }).type === "toolCall",
	).length;
}

function timingFromDetails(details: unknown): Timing | undefined {
	if (typeof details !== "object" || details === null) return undefined;
	const candidate = details as { startedAt?: unknown; completedAt?: unknown };
	if (typeof candidate.startedAt !== "string" || typeof candidate.completedAt !== "string") return undefined;
	const startedAtMs = Date.parse(candidate.startedAt);
	const completedAtMs = Date.parse(candidate.completedAt);
	if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs)) return undefined;
	return { startedAtMs, completedAtMs };
}

function hydrateToolCardTimings(entries: readonly unknown[]): void {
	for (const entry of entries) {
		if (typeof entry !== "object" || entry === null) continue;
		const candidate = entry as { type?: unknown; customType?: unknown; data?: unknown };
		if (candidate.type !== "custom" || typeof candidate.customType !== "string") continue;

		if (candidate.customType === TOOL_RECORD_TYPE) {
			if (typeof candidate.data !== "object" || candidate.data === null) continue;
			const details = candidate.data as { toolCallId?: unknown };
			const timing = timingFromDetails(candidate.data);
			if (typeof details.toolCallId !== "string" || !timing) continue;
			setToolCardTiming(details.toolCallId, { tool: timing });
			continue;
		}

		if (candidate.customType === TURN_RECORD_TYPE) {
			if (typeof candidate.data !== "object" || candidate.data === null) continue;
			const details = candidate.data as { displayToolCallId?: unknown };
			const timing = timingFromDetails(candidate.data);
			if (typeof details.displayToolCallId !== "string" || !timing) continue;
			setToolCardTiming(details.displayToolCallId, { turn: timing });
		}
	}
}

function createExtension(loadSettings: SettingsLoader) {
	return function turnTimestamps(pi: ExtensionAPI) {
		let activeTurn: ActiveTurn | undefined;
		const toolStarts = new Map<string, ToolStart>();
		const pendingTerminalTurns: Array<{ details: TurnTimestampDetails; timing: Timing }> = [];
		let cachedSettings = DEFAULT_SETTINGS;

		pi.setLabel("Turn timestamps");

		try {
			installToolCardTimingPatch(
				pi.pi.ToolExecutionComponent as unknown as ToolExecutionConstructor,
			);
		} catch (error) {
			pi.logger.warn("Failed to install tool-card timing renderer", {
				extension: PLUGIN_NAME,
				error: String(error),
			});
		}

		const refreshSettings = async (cwd: string): Promise<TimingSettings> => {
			try {
				cachedSettings = await loadSettings(cwd);
			} catch (error) {
				pi.logger.warn("Failed to load turn timestamp settings; using cached/default values", {
					extension: PLUGIN_NAME,
					error: String(error),
				});
			}
			return cachedSettings;
		};

		const restoreCardTimings = async (
			_event: unknown,
			ctx: { cwd: string; sessionManager: { getBranch(): readonly unknown[] } },
		) => {
			hydrateToolCardTimings(ctx.sessionManager.getBranch());
			await refreshSettings(ctx.cwd);
		};

		pi.on("session_start", restoreCardTimings);
		pi.on("session_switch", restoreCardTimings);
		pi.on("session_branch", restoreCardTimings);

		pi.on("turn_start", (event, ctx) => {
			const turn: ActiveTurn = {
				turnIndex: event.turnIndex,
				startedAtMs: event.timestamp,
				expectedToolResults: 0,
				completedToolResults: 0,
				turnTimingAttached: false,
				settings: cachedSettings,
				settingsReady: refreshSettings(ctx.cwd),
			};
			activeTurn = turn;
			toolStarts.clear();
			void turn.settingsReady.then(settings => {
				if (activeTurn === turn) turn.settings = settings;
			});
		});

		pi.on("message_end", async event => {
			if (!activeTurn) return;
			const expected = countToolCalls(event.message);
			if (expected > 0) activeTurn.expectedToolResults = expected;
		});

		pi.on("tool_call", async event => {
			const turn = activeTurn;
			if (!turn) return;
			toolStarts.set(event.toolCallId, {
				toolName: event.toolName,
				startedAtMs: Date.now(),
				turnIndex: turn.turnIndex,
			});
		});

		pi.on("tool_result", async event => {
			const turn = activeTurn;
			if (!turn) return;

			turn.settings = await turn.settingsReady;
			const completedAtMs = Date.now();
			turn.completedToolResults++;

			const start = toolStarts.get(event.toolCallId);
			toolStarts.delete(event.toolCallId);
			if (turn.settings.showToolTiming && start) {
				const timing: Timing = {
					startedAtMs: start.startedAtMs,
					completedAtMs,
				};
				const details: ToolTimestampDetails = {
					...timingDetails(start.turnIndex, timing),
					toolCallId: event.toolCallId,
					toolName: start.toolName,
					isError: event.isError,
				};
				pi.appendEntry(TOOL_RECORD_TYPE, details);
				setToolCardTiming(event.toolCallId, { tool: timing });
			}

			const isLastToolResult =
				turn.expectedToolResults > 0 &&
				turn.completedToolResults >= turn.expectedToolResults;
			if (turn.settings.showTurnTiming && isLastToolResult) {
				const timing: Timing = {
					startedAtMs: turn.startedAtMs,
					completedAtMs,
				};
				turn.turnTimingAttached = true;
				turn.displayToolCallId = event.toolCallId;
				turn.displayCompletedAtMs = completedAtMs;
				setToolCardTiming(event.toolCallId, { turn: timing });
			}
		});

		pi.on("turn_end", async event => {
			const turn = activeTurn;
			if (!turn || turn.turnIndex !== event.turnIndex) return;
			turn.settings = await turn.settingsReady;
			const timing: Timing = {
				startedAtMs: turn.startedAtMs,
				completedAtMs: turn.displayCompletedAtMs ?? Date.now(),
			};
			const details = timingDetails(turn.turnIndex, timing, turn.displayToolCallId);
			pi.appendEntry(TURN_RECORD_TYPE, details);

			if (turn.settings.showTurnTiming && !turn.turnTimingAttached) {
				pendingTerminalTurns.push({ details, timing });
			}

			activeTurn = undefined;
			toolStarts.clear();
		});

		pi.on("agent_end", async event => {
			if (event.willContinue || pendingTerminalTurns.length === 0) return;
			const pending = pendingTerminalTurns.splice(0);
			for (const { details, timing } of pending) {
				pi.sendMessage<TurnTimestampDetails>(
					{
						customType: TURN_CUSTOM_TYPE,
						content: formatTurnTimingLine(timing),
						display: true,
						details,
					},
					{ triggerTurn: false },
				);
			}
		});

		// The only visible custom message left is the fallback for a terminal
		// no-tool turn. Keep it out of future provider context.
		pi.on("context", async event => {
			const messages = event.messages.filter(
				message => message.role !== "custom" || message.customType !== TURN_CUSTOM_TYPE,
			);
			return messages.length === event.messages.length ? undefined : { messages };
		});
	};
}

export const createTurnTimestampsExtension = createExtension;
export default createExtension(loadTimingSettings);
