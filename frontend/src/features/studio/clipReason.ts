const FRAMING_KEYS: Record<string, string> = {
  speaker: 'Reframed to follow the speaker',
  full_frame: 'No one to follow on screen, so the full frame is kept',
  full_frame_pending: 'Speaker detection is still being set up, so this one keeps the full frame',
  full_frame_captions: 'The source has built-in captions, so the full frame is kept to avoid cutting them',
}

export type ClipReason = { kind: 'evidence'; evidence: string } | { kind: 'framing' | 'content'; key: string }

/** One local line for a card. The sentence stays on the device and is never an event property. */
export function clipReason(input: { evidence?: string | null; framing?: string | null }): ClipReason {
  const evidence = (input.evidence || '').replace(/\s+/g, ' ').trim()
  if (evidence) return { kind: 'evidence', evidence }
  const framing = input.framing && FRAMING_KEYS[input.framing]
  if (framing) return { kind: 'framing', key: framing }
  return { kind: 'content', key: 'Chosen because the moment is complete' }
}
