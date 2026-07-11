// game/ui/styles.js — shared inline-style helpers, ported from the Claude Design
// prototype's computed-style methods so padding/font/color values never drift
// between screens. Pure string builders (no DOM), every color a var(--token) so
// theme switching is free. Two placeholder helpers live here and mean different
// things by design:
//   placeholderStripeStyle() — NEUTRAL gray "no image yet" fill (portrait / item
//     image / craft output preview), exactly the prototype's gradient.
//   unwiredOverlayStyle()    — WARNING amber hazard stripes for elements not
//     backed by a real engine (applied via dom.js:markUnwired). Same stripe
//     PATTERN, different hue, so the two meanings stay visually separable.

// --- Fonts (match the prototype) -------------------------------------------
export const FONT_HEAD = "'Barlow Semi Condensed',sans-serif";
export const FONT_BODY = 'Inter,sans-serif';

// --- Shared CTA buttons (the prototype's Part 1b helpers, verbatim values) --
export function primaryActionButtonStyle() {
  return "background:var(--accent); color:var(--accent-contrast); border:none; border-radius:5px; padding:8px 16px; font:600 12px 'Barlow Semi Condensed',sans-serif; letter-spacing:0.02em; cursor:pointer;";
}
export function secondaryActionButtonStyle() {
  return "background:transparent; border:1px solid var(--border-strong); color:var(--text-muted); border-radius:5px; padding:8px 16px; font:600 12px 'Barlow Semi Condensed',sans-serif; cursor:pointer;";
}
export function smallAccentButtonStyle() {
  return "background:transparent; border:1px solid var(--accent); color:var(--accent-strong); border-radius:4px; padding:4px 9px; font:600 10.5px 'Barlow Semi Condensed',sans-serif; cursor:pointer;";
}

// --- Panels / section labels ------------------------------------------------
export function panelStyle(extra = '') {
  return `background:var(--panel); border:1px solid var(--border); border-radius:6px; ${extra}`;
}
export function sectionLabelStyle() {
  return "font:600 10px 'Barlow Semi Condensed',sans-serif; color:var(--text-faint); text-transform:uppercase; letter-spacing:0.05em;";
}

// --- Risk chip (the flagged UNWIRED example — style ported; the value it shows
// is marked unwired at the call site, never faked) --------------------------
export function riskLabelFor(risk) {
  if (risk === 'low') return 'Low';
  if (risk === 'medium') return 'Med';
  return 'High';
}
export function riskChipStyle(risk) {
  const map = { low: 'var(--good)', medium: 'var(--accent)', high: 'var(--danger)' };
  const bg = { low: 'var(--good-soft)', medium: 'var(--accent-soft)', high: 'var(--danger-soft)' }[risk];
  const color = map[risk] || 'var(--text-muted)';
  return `background:${bg}; color:${color}; border:1px solid ${color}; border-radius:3px; padding:2px 7px; font:600 9.5px 'Barlow Semi Condensed',sans-serif; text-align:center; flex:none;`;
}

// --- Chips ------------------------------------------------------------------
export const emotionChipStyle =
  "background:var(--info-soft); color:var(--info); border-radius:3px; padding:1px 6px; font:600 9px 'Barlow Semi Condensed',sans-serif; text-transform:uppercase; letter-spacing:0.04em;";

export function tierChipStyle() {
  return "background:var(--accent-soft); color:var(--accent-strong); border:1px solid var(--accent); border-radius:3px; padding:2px 7px; font:600 10px 'Barlow Semi Condensed',sans-serif;";
}
export function accentPillStyle() {
  return "background:var(--info-soft); color:var(--info); border-radius:3px; padding:2px 6px; font:600 9.5px 'Barlow Semi Condensed',sans-serif;";
}

export function factionChipStyle(level) {
  const map = { good: 'var(--good)', danger: 'var(--danger)', muted: 'var(--text-faint)' };
  const soft = { good: 'var(--good-soft)', danger: 'var(--danger-soft)', muted: 'var(--panel-alt)' };
  const c = map[level] || 'var(--text-faint)';
  return `background:${soft[level] || 'var(--panel-alt)'}; color:${c}; border:1px solid ${c}; border-radius:3px; padding:2px 7px; font:600 9.5px 'Barlow Semi Condensed',sans-serif; flex:none;`;
}

export function statusChipStyle(status) {
  const active = status === 'active';
  return `background:${active ? 'var(--accent-soft)' : 'var(--good-soft)'}; color:${active ? 'var(--accent-strong)' : 'var(--good)'}; border:1px solid ${active ? 'var(--accent)' : 'var(--good)'}; border-radius:3px; padding:2px 7px; font:600 9px 'Barlow Semi Condensed',sans-serif; text-transform:uppercase; letter-spacing:0.04em; flex:none;`;
}

// --- Tabs / toggles ---------------------------------------------------------
export function journalTabStyle(active) {
  return `background:${active ? 'var(--accent-soft)' : 'transparent'}; border:1px solid ${active ? 'var(--accent)' : 'var(--border)'}; color:${active ? 'var(--accent-strong)' : 'var(--text-muted)'}; border-radius:4px; padding:6px 12px; font:600 11px 'Barlow Semi Condensed',sans-serif; letter-spacing:0.03em; cursor:pointer;`;
}
export function categoryBtnStyle(active) {
  return `background:${active ? 'var(--accent-soft)' : 'transparent'}; border:1px solid ${active ? 'var(--accent)' : 'var(--border)'}; color:${active ? 'var(--accent-strong)' : 'var(--text-muted)'}; border-radius:5px; width:32px; height:32px; display:flex; align-items:center; justify-content:center; cursor:pointer; flex:none;`;
}
export function mobileTabStyle(active) {
  return `flex:1; display:flex; flex-direction:column; align-items:center; gap:2px; padding:7px 0; background:transparent; border:none; color:${active ? 'var(--accent-strong)' : 'var(--text-faint)'}; cursor:pointer;`;
}
export const hudIconStyle =
  'background:transparent; border:1px solid transparent; color:var(--text-muted); border-radius:4px; width:30px; height:30px; display:flex; align-items:center; justify-content:center; cursor:pointer;';

// --- Inventory rows / slots -------------------------------------------------
export function itemRowStyle(active) {
  return `display:grid; grid-template-columns: 1.8fr 0.8fr 0.6fr 0.6fr 0.5fr; gap:6px; align-items:center; padding:7px 10px; cursor:pointer; background:${active ? 'var(--accent-soft)' : 'transparent'}; border-left:2px solid ${active ? 'var(--accent)' : 'transparent'};`;
}
export function itemCardStyle(active) {
  return `background:var(--panel-alt); border:1px solid ${active ? 'var(--accent)' : 'var(--border)'}; border-radius:6px; padding:9px 11px; cursor:pointer;`;
}
export function slotChipStyle(filled) {
  return `position:absolute; transform:translate(-50%,-50%); background:${filled ? 'var(--accent-soft)' : 'var(--panel-alt)'}; border:1px solid ${filled ? 'var(--accent)' : 'var(--border-strong)'}; border-radius:4px; padding:3px 6px; font:600 8.5px 'Barlow Semi Condensed',sans-serif; color:${filled ? 'var(--accent-strong)' : 'var(--text-faint)'}; text-align:center; white-space:nowrap; cursor:pointer;`;
}

// --- Trading / craft --------------------------------------------------------
export function tradeRowStyle(inOffer) {
  return `display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:5px; cursor:pointer; background:${inOffer ? 'var(--accent-soft)' : 'var(--panel-alt)'}; border:1px solid ${inOffer ? 'var(--accent)' : 'var(--border)'};`;
}
export function craftStationTabStyle(active, accent) {
  return `background:${active ? 'var(--panel-alt)' : 'transparent'}; border:1px solid ${active ? accent : 'var(--border)'}; color:${active ? accent : 'var(--text-muted)'}; border-radius:4px; padding:6px 12px; font:600 11px 'Barlow Semi Condensed',sans-serif; cursor:pointer;`;
}
export function craftRecipeRowStyle(active, accent) {
  return `display:flex; flex-direction:column; gap:2px; padding:8px 10px; border-radius:5px; cursor:pointer; background:${active ? 'var(--panel-alt)' : 'transparent'}; border-left:2px solid ${active ? accent : 'transparent'};`;
}
export function craftIngredientStyle(filled) {
  const c = filled ? 'var(--good)' : 'var(--danger)';
  return `display:flex; align-items:center; justify-content:space-between; gap:8px; background:var(--panel-alt); border:1px solid ${c}; border-radius:5px; padding:8px 10px;`;
}

// --- Conversation bubbles ---------------------------------------------------
export function transcriptLineWrapStyle(who) {
  const align = who === 'player' ? 'flex-end' : 'flex-start';
  return `display:flex; flex-direction:column; align-items:${align}; gap:4px;`;
}
export function transcriptBubbleStyle(who) {
  if (who === 'npc') {
    return 'max-width:80%; background:var(--panel-alt); border-left:2px solid var(--info); border-radius:0 6px 6px 6px; padding:8px 12px; font:400 12.5px Inter,sans-serif; color:var(--text); line-height:1.45;';
  }
  return 'max-width:80%; background:var(--accent-soft); border:1px solid var(--border-strong); border-radius:6px; padding:8px 12px; font:400 12.5px Inter,sans-serif; color:var(--text); line-height:1.45;';
}
export function bubbleWrapStyle(who) {
  const align = who === 'player' ? 'flex-end' : 'flex-start';
  return `display:flex; justify-content:${align};`;
}
export function chatBubbleStyleFor(who) {
  if (who === 'npc') {
    return 'max-width:70%; background:var(--panel-alt); border-radius:12px 12px 12px 3px; padding:8px 12px; font:400 12.5px Inter,sans-serif; color:var(--text); line-height:1.45;';
  }
  return 'max-width:70%; background:var(--accent-soft); border-radius:12px 12px 3px 12px; padding:8px 12px; font:400 12.5px Inter,sans-serif; color:var(--text); line-height:1.45;';
}

// --- Progress bars ----------------------------------------------------------
export function barTrackStyle(height = 5) {
  return `width:100%; height:${height}px; border-radius:3px; background:var(--border); overflow:hidden;`;
}
export function barFillStyle(pct, color = 'var(--accent)') {
  return `width:${Math.max(0, Math.min(100, pct))}%; height:100%; background:${color};`;
}

// --- Placeholders -----------------------------------------------------------
// NEUTRAL "no image yet" — gray, opaque, exactly the prototype's fill.
export function placeholderStripeStyle(aspect = 1) {
  return `width:100%; aspect-ratio:${aspect}; border-radius:5px; background:repeating-linear-gradient(45deg, var(--panel-alt), var(--panel-alt) 8px, var(--bg-soft) 8px, var(--bg-soft) 16px); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; font:600 10px 'Barlow Semi Condensed',sans-serif; color:var(--text-faint); letter-spacing:0.06em;`;
}

// WARNING "not wired to a real engine" — amber hazard stripes, translucent so the
// marked control's own content stays legible. Applied by dom.js:markUnwired.
export function unwiredOverlayStyle() {
  return 'position:absolute; inset:0; pointer-events:none; border-radius:inherit; background:repeating-linear-gradient(45deg, var(--unwired-stripe-color) 0 6px, transparent 6px 12px);';
}
