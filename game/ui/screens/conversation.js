// game/ui/screens/conversation.js — Conversation, variants A (portrait) and B
// (chat log). WIRED: NPC identity, accent chip (voice.accent), relationship tier
// (relationshipStore.relationshipTier), memory summaries, live transcript
// (conversationHistoryStore), current emotion (deriveEmotion), and the real Say
// flow (startDialogue → getDialogue → record lines → endDialogue). UNWIRED
// (marked): the relationship % meter (no 0-100 scale) and the suggested
// dialogue-choice buttons (no option generator; only freeform Say is real).

import { div, span, el, button } from '../dom.js';
import { buildConversation } from '../model.js';
import { getRecentHistory } from '../../../entities/conversationHistoryStore.js';
import {
  panelStyle, sectionLabelStyle, primaryActionButtonStyle, placeholderStripeStyle,
  tierChipStyle, accentPillStyle, emotionChipStyle, barTrackStyle, barFillStyle,
  transcriptLineWrapStyle, transcriptBubbleStyle, bubbleWrapStyle, chatBubbleStyleFor,
} from '../styles.js';

export function renderConversation(ui) {
  return ui.state.convoVariant === 'b' ? convoChat(ui) : convoPortrait(ui);
}

// ---- Variant A: portrait + dialogue ---------------------------------------
function convoPortrait(ui) {
  const m = buildConversation(ui.ctx);

  const portrait = div(placeholderStripeStyle(1), { text: 'PORTRAIT' });
  const card = div(panelStyle('padding:10px; display:flex; flex-direction:column; gap:8px;'), {
    children: [
      portrait,
      div('', { children: [
        div("font:600 14px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: m.name }),
        div('font:500 10.5px Inter,sans-serif; color:var(--text-faint); margin-top:2px;', { text: m.sub }),
      ] }),
      div('display:flex; align-items:center; gap:6px; flex-wrap:wrap;', { children: [
        span(tierChipStyle(), { text: m.tier }),
        span(emotionChipStyle, { text: m.emotion }),
        span('font:500 10px Inter,sans-serif; color:var(--text-faint);', { text: 'progress', unwired: m.percent.unwired }),
      ] }),
      div(barTrackStyle(5), { children: [div(barFillStyle(50))], unwired: m.percent.unwired }),
    ],
  });

  const memoryPanel = div(panelStyle('padding:10px; flex:1; min-height:0; overflow:auto;'));
  memoryPanel.appendChild(div(sectionLabelStyle() + ' padding-bottom:6px;', { text: 'Memory' }));
  memoryList(memoryPanel, m.memories);

  const left = div('display:flex; flex-direction:column; gap:8px;', { children: [card, memoryPanel] });

  const transcript = div(panelStyle('padding:12px; flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:10px;'));
  renderTranscript(transcript, m, true);

  const inputRow = inputBar(ui);
  const choices = div(panelStyle('padding:10px; display:flex; flex-direction:column; gap:6px;'), {
    children: [suggestedChoices(m), inputRow],
  });

  const right = div('display:flex; flex-direction:column; gap:8px; min-height:0;', { children: [transcript, choices] });

  return div('display:grid; grid-template-columns: minmax(220px,260px) minmax(0,1fr); gap:10px; padding:10px; min-height:calc(100vh - 92px);',
    { children: [left, right] });
}

// ---- Variant B: chat log + sidebar ----------------------------------------
function convoChat(ui) {
  const m = buildConversation(ui.ctx);

  const header = div(panelStyle('padding:8px 12px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;'), {
    children: [
      div('width:26px; height:26px; border-radius:50%; background:var(--panel-alt); border:1px solid var(--border-strong); flex:none;'),
      div("font:600 12.5px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: m.name }),
      span(accentPillStyle(), { text: m.accent }),
      span(emotionChipStyle, { text: m.emotion }),
    ],
  });

  const chat = div(panelStyle('padding:12px; flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:8px;'));
  renderTranscript(chat, m, false);

  const left = div('display:flex; flex-direction:column; gap:8px; min-height:0;', {
    children: [header, chat, div(panelStyle('padding:10px; display:flex; gap:6px;'), { children: [inputBar(ui)] })],
  });

  const relPanel = div(panelStyle('padding:10px;'), { children: [
    div(sectionLabelStyle() + ' padding-bottom:6px;', { text: 'Relationship' }),
    div('display:flex; align-items:center; gap:6px; margin-bottom:6px; flex-wrap:wrap;', { children: [
      span(tierChipStyle(), { text: m.tier }),
      span('font:500 10px Inter,sans-serif; color:var(--text-faint);', { text: 'progress', unwired: m.percent.unwired }),
    ] }),
    div(barTrackStyle(5), { children: [div(barFillStyle(50))], unwired: m.percent.unwired }),
    div('font:400 10px Inter,sans-serif; color:var(--text-faint); margin-top:6px; line-height:1.4;',
      { text: Object.entries(m.stats).map(([k, v]) => `${k} ${v}`).join(' · ') }),
  ] });
  const memPanel = div(panelStyle('padding:10px; flex:1; min-height:0; overflow:auto;'));
  memPanel.appendChild(div(sectionLabelStyle() + ' padding-bottom:6px;', { text: 'Memory' }));
  memoryList(memPanel, m.memories);

  const right = div('display:flex; flex-direction:column; gap:8px;', { children: [relPanel, memPanel] });

  return div('display:grid; grid-template-columns: minmax(0,1fr) minmax(200px,240px); gap:10px; padding:10px; min-height:calc(100vh - 92px);',
    { children: [left, right] });
}

// ---- Shared pieces ---------------------------------------------------------
function memoryList(panel, memories) {
  if (!memories.length) {
    panel.appendChild(div('font:400 11.5px Inter,sans-serif; color:var(--text-faint); padding:5px 0; font-style:italic;',
      { text: 'No memories yet — she has nothing on you.' }));
    return;
  }
  for (const mem of memories) {
    panel.appendChild(div('font:400 11.5px Inter,sans-serif; color:var(--text-muted); line-height:1.4; padding:5px 0; border-top:1px solid var(--border);', { text: mem }));
  }
}

function renderTranscript(host, m, showEmotionOnLast) {
  if (!m.transcript.length) {
    host.appendChild(div('font:400 12px Inter,sans-serif; color:var(--text-faint); font-style:italic;',
      { text: 'Say something to begin the conversation.' }));
    return;
  }
  const lastNpcIdx = m.transcript.map((l) => l.who).lastIndexOf('npc');
  m.transcript.forEach((line, idx) => {
    if (showEmotionOnLast) {
      const wrap = div(transcriptLineWrapStyle(line.who));
      if (line.who === 'npc' && idx === lastNpcIdx) wrap.appendChild(span(emotionChipStyle, { text: m.emotion }));
      wrap.appendChild(div(transcriptBubbleStyle(line.who), { text: line.text }));
      host.appendChild(wrap);
    } else {
      const wrap = div(bubbleWrapStyle(line.who));
      wrap.appendChild(div(chatBubbleStyleFor(line.who), { text: line.text }));
      host.appendChild(wrap);
    }
  });
}

// Suggested dialogue choices — no generator exists, so these are inert and
// hazard-marked; only the freeform Say box below is real.
function suggestedChoices(m) {
  const grid = div('display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:6px;');
  for (let i = 0; i < m.choices.count; i++) {
    grid.appendChild(button('Suggested reply', 'background:var(--panel-alt); border:1px solid var(--border-strong); color:var(--text-faint); border-radius:5px; padding:8px 10px; font:500 11.5px Inter,sans-serif; text-align:left; cursor:not-allowed;',
      null, { disabled: true, unwired: m.choices.unwired }));
  }
  return grid;
}

function inputBar(ui) {
  const input = el('input', 'flex:1; background:var(--bg-soft); border:1px solid var(--border-strong); color:var(--text); border-radius:5px; padding:8px 10px; font:400 12px Inter,sans-serif;', {
    attrs: { placeholder: `Say something to ${ui.ctx.npc.identity.firstName}…` },
  });
  input.id = 'convo-input';
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') say(ui, input); });
  const sendBtn = button('Say', primaryActionButtonStyle(), () => say(ui, input));
  return div('display:flex; gap:6px; margin-top:2px; width:100%;', { children: [input, sendBtn] });
}

// The real dialogue verb — brackets the AI call with start/endDialogue (time
// context 'chatting'→'idle'), records both lines, re-renders. Mirrors the harness.
async function say(ui, input) {
  const { ctx } = ui;
  const { player, npc, engines, world } = ctx;
  const line = (input.value || '').trim();
  if (!line) return;
  input.value = '';
  ctx.actions.startDialogue(world, player.id, npc.id);
  try {
    const edge = engines.relationships.getRelationship(npc.id, player.id);
    const recent = getRecentHistory(engines.conversationHistory.getConversationHistory(npc.id, player.id));
    const result = await ctx.getDialogue(npc, edge, npc.psychology.memories, line, world.getEventLog(), recent);
    engines.conversationHistory.recordDialogueLine(npc.id, player.id, player.id, line);
    engines.conversationHistory.recordDialogueLine(npc.id, player.id, npc.id, result.response.dialogue);
  } catch (err) {
    engines.conversationHistory.recordDialogueLine(npc.id, player.id, player.id, line);
    engines.conversationHistory.recordDialogueLine(npc.id, player.id, npc.id, '(…she says nothing.)');
  } finally {
    ctx.actions.endDialogue(world, player.id, npc.id);
    ui.setState({});
  }
}
