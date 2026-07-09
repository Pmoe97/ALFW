// ai/sharedQueue.js — the single AI call queue shared across the game.
//
// queueManager.js documents the intent that "every AI call in the game (text
// today, image later) routes through here" and that the foreground/background
// split only means anything if both lanes draw on ONE budget. So the queue
// instance lives here and is imported by every transport (generateDialogue's
// foreground dialogue, generateSummary's background memory lines) rather than
// each module minting its own — two independent queues would each get a full
// concurrency budget and the foreground-headroom guarantee would be a lie.

import { createQueueManager } from './queueManager.js';

export const aiQueue = createQueueManager();
