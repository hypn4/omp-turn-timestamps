import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { formatToolTimingLine, formatTurnTimingLine, type Timing } from "./format";

const PLUGIN_NAME = "omp-turn-timestamps";
const TURN_CUSTOM_TYPE = "omp-turn-timestamp";
const TOOL_CUSTOM_TYPE = "omp-tool-timestamp";
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
	settings: TimingSettings;
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
}

interface ToolTimestampDetails extends TurnTimestampDetails {
	toolCallId: string;
	toolName: string;
	isError: boolean;
}

interface PendingCard {
	customType: typeof TURN_CUSTOM_TYPE | typeof TOOL_CUSTOM_TYPE;
	content: string;
	details: TurnTimestampDetails | ToolTimestampDetails;
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

function timingDetails(turnIndex: number, timing: Timing): TurnTimestampDetails {
	return {
		turnIndex,
		startedAt: new Date(timing.startedAtMs).toISOString(),
		completedAt: new Date(timing.completedAtMs).toISOString(),
		elapsedMs: Math.max(0, timing.completedAtMs - timing.startedAtMs),
	};
}

function hasTerminalYield(toolResults: unknown[]): boolean {
	return toolResults.some(result => {
		if (typeof result !== "object" || result === null) return false;
		const candidate = result as { toolName?: unknown; isError?: unknown };
		return candidate.toolName === "yield" && candidate.isError !== true;
	});
}

function createExtension(loadSettings: SettingsLoader) {
	return function turnTimestamps(pi: ExtensionAPI) {
		let activeTurn: ActiveTurn | undefined;
		const toolStarts = new Map<string, ToolStart>();
		const pendingTerminalCards: PendingCard[] = [];

		pi.setLabel("Turn timestamps");

		const sendCard = (card: PendingCard, deliverAsAside: boolean) => {
			pi.sendMessage(
				{
					customType: card.customType,
					content: card.content,
					display: true,
					details: card.details,
				},
				deliverAsAside
					? { triggerTurn: false, deliverAs: "aside" }
					: { triggerTurn: false },
			);
		};

		pi.on("turn_start", async (event, ctx) => {
			let settings = DEFAULT_SETTINGS;
			try {
				settings = await loadSettings(ctx.cwd);
			} catch (error) {
				pi.logger.warn("Failed to load turn timestamp settings; using defaults", {
					extension: PLUGIN_NAME,
					error: String(error),
				});
			}

			activeTurn = {
				turnIndex: event.turnIndex,
				startedAtMs: event.timestamp,
				settings,
			};
			toolStarts.clear();
		});

		pi.on("tool_call", async event => {
			const turn = activeTurn;
			if (!turn?.settings.showToolTiming) return;
			toolStarts.set(event.toolCallId, {
				toolName: event.toolName,
				startedAtMs: Date.now(),
				turnIndex: turn.turnIndex,
			});
		});

		pi.on("tool_result", async event => {
			const turn = activeTurn;
			if (!turn?.settings.showToolTiming) return;

			const start = toolStarts.get(event.toolCallId);
			toolStarts.delete(event.toolCallId);
			if (!start) return;

			const timing: Timing = {
				startedAtMs: start.startedAtMs,
				completedAtMs: Date.now(),
			};
			const details: ToolTimestampDetails = {
				...timingDetails(start.turnIndex, timing),
				toolCallId: event.toolCallId,
				toolName: start.toolName,
				isError: event.isError,
			};
			pi.appendEntry(TOOL_RECORD_TYPE, details);

			const card: PendingCard = {
				customType: TOOL_CUSTOM_TYPE,
				content: formatToolTimingLine({ toolName: start.toolName, ...timing }),
				details,
			};

			// OMP's terminal tool is yield; it intentionally stops before another
			// model step. Every other completed tool result belongs to a tool-bearing
			// turn that already has a continuation boundary, so an aside is passive.
			if (start.toolName === "yield" && !event.isError) pendingTerminalCards.push(card);
			else sendCard(card, true);
		});

		pi.on("turn_end", async event => {
			const turn = activeTurn;
			if (!turn || turn.turnIndex !== event.turnIndex) return;

			const timing: Timing = {
				startedAtMs: turn.startedAtMs,
				completedAtMs: Date.now(),
			};
			const details = timingDetails(turn.turnIndex, timing);
			pi.appendEntry(TURN_RECORD_TYPE, details);

			if (turn.settings.showTurnTiming) {
				const card: PendingCard = {
					customType: TURN_CUSTOM_TYPE,
					content: formatTurnTimingLine(timing),
					details,
				};
				const toolResults = Array.isArray(event.toolResults) ? event.toolResults : [];
				const hasPassiveContinuation =
					toolResults.length > 0 && !hasTerminalYield(toolResults);
				if (hasPassiveContinuation) sendCard(card, true);
				else pendingTerminalCards.push(card);
			}

			activeTurn = undefined;
			toolStarts.clear();
		});

		pi.on("agent_end", async event => {
			if (event.willContinue || pendingTerminalCards.length === 0) return;
			const pending = pendingTerminalCards.splice(0);
			for (const card of pending) sendCard(card, false);
		});

		// Timing cards are transcript-only. Structured appendEntry records are
		// metadata-only already; remove visible cards from future provider context.
		pi.on("context", async event => {
			const messages = event.messages.filter(
				message =>
					message.role !== "custom" ||
					(message.customType !== TURN_CUSTOM_TYPE && message.customType !== TOOL_CUSTOM_TYPE),
			);
			return messages.length === event.messages.length ? undefined : { messages };
		});
	};
}

export const createTurnTimestampsExtension = createExtension;
export default createExtension(loadTimingSettings);
