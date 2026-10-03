import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { formatTurnTimingLine } from "./format";

const CUSTOM_TYPE = "omp-turn-timestamp";

interface TurnTimestampDetails {
	startedAt: string;
	completedAt: string;
	elapsedMs: number;
}

export default function turnTimestamps(pi: ExtensionAPI) {
	let startedAtMs: number | undefined;

	pi.setLabel("Turn timestamps");

	pi.on("agent_start", async () => {
		startedAtMs ??= Date.now();
	});

	pi.on("agent_end", async event => {
		if (event.willContinue) return;

		const start = startedAtMs;
		startedAtMs = undefined;
		if (start === undefined) {
			pi.logger.warn("Turn timestamp skipped because no agent_start was observed", {
				extension: CUSTOM_TYPE,
			});
			return;
		}

		const completedAtMs = Date.now();
		const elapsedMs = Math.max(0, completedAtMs - start);
		const details: TurnTimestampDetails = {
			startedAt: new Date(start).toISOString(),
			completedAt: new Date(completedAtMs).toISOString(),
			elapsedMs,
		};

		pi.sendMessage<TurnTimestampDetails>(
			{
				customType: CUSTOM_TYPE,
				content: formatTurnTimingLine({ startedAtMs: start, completedAtMs }),
				display: true,
				details,
			},
			{ triggerTurn: false },
		);
	});

	// The timestamp is a transcript-only breadcrumb. Keep it out of future LLM context
	// so timing metadata never consumes context tokens or affects model behavior.
	pi.on("context", async event => {
		const messages = event.messages.filter(
			message => message.role !== "custom" || message.customType !== CUSTOM_TYPE,
		);
		if (messages.length === event.messages.length) return undefined;
		return { messages };
	});
}
