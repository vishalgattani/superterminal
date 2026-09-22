/**
 * Display form of a Claude model name.
 *
 * `claude-sonnet-5` reads as `sonnet-5` on a node: the vendor prefix is the
 * same on every card, so it is width spent saying nothing, and a trailing date
 * is detail the tooltip can carry. The full name stays in the tooltip, because
 * "which model exactly" is the question the pill exists to answer.
 */
export function shortModel(m: string): string {
  return m.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

/**
 * The text of a node's model pill, or undefined for no pill.
 *
 * Only while a Claude is running in the terminal. The model is what Claude was
 * started with; a bare shell (or one a Claude has exited back to) has no model
 * to show, and a "sonnet-5" there reads as a Claude that is not there.
 * `claudeSessionId` is present exactly while a Claude row exists for the
 * terminal, so it is the signal.
 */
export function modelLabel(
  model: string | undefined,
  claudeSessionId: string | undefined,
): string | undefined {
  if (!model || !claudeSessionId) return undefined;
  return shortModel(model);
}
