/** T3 local model analysis gate: params < 7B or context < 8k → red warn (still selectable). */

export const LOCAL_MIN_PARAMS_B = 7
export const LOCAL_MIN_CONTEXT_TOKENS = 8192

export const LOCAL_RECOMMENDED_MODELS = [
  { id: 'qwen2.5:7b', label: 'qwen2.5:7b' },
  { id: 'qwen2.5:14b', label: 'qwen2.5:14b' },
  { id: 'llama3.1:8b', label: 'llama3.1:8b' },
] as const

export type LocalSizeFields = {
  id?: string
  params_b?: number | null
  context_tokens?: number | null
}

const NAME_PARAMS_RE = /\b([0-9]+(?:\.[0-9]+)?)[bB]\b/g

export function inferParamsBFromName(name?: string | null): number | null {
  if (!name) return null
  const matches = [...name.matchAll(NAME_PARAMS_RE)].map(m => Number(m[1])).filter(n => n > 0)
  return matches.length ? matches[matches.length - 1] : null
}

export function belowLocalAnalysisGate(model: LocalSizeFields | null | undefined): boolean {
  if (!model) return false
  const params = typeof model.params_b === 'number' ? model.params_b : inferParamsBFromName(model.id)
  const context = model.context_tokens
  if (typeof params === 'number' && params < LOCAL_MIN_PARAMS_B) return true
  if (typeof context === 'number' && context < LOCAL_MIN_CONTEXT_TOKENS) return true
  return false
}

/** Size / context label for the picker. LM Studio without a size → 「Unknown」. */
export function localModelSizeLabel(
  model: LocalSizeFields & { id?: string },
  provider?: string | null,
): string {
  const parts: string[] = []
  const params = typeof model.params_b === 'number' ? model.params_b : inferParamsBFromName(model.id)
  if (typeof params === 'number') {
    const rounded = Number.isInteger(params) ? String(params) : String(params)
    parts.push(`${rounded}B`)
  } else if (provider === 'lmstudio') {
    parts.push('Unknown')
  }
  if (typeof model.context_tokens === 'number') {
    const k = model.context_tokens >= 1024
      ? `${Math.round(model.context_tokens / 1024)}k`
      : String(model.context_tokens)
    parts.push(`ctx ${k}`)
  } else if (provider === 'lmstudio' && typeof model.params_b !== 'number') {
    // already 「Unknown」 for params; skip duplicate
  } else if (provider === 'lmstudio') {
    parts.push('ctx Unknown')
  }
  return parts.join(' · ')
}

export function localAnalysisWarnCopy(): string {
  return 'Likely to fail parsing — not recommended for analysis'
}

export function localRecommendCopy(): string {
  return 'Recommended: qwen2.5:7b / 14b (Chinese) or llama3.1:8b'
}
