import raw from '@provider-presets'
import { qualityFor, type LatencyTier, type SuccessTier } from './providerQuality'

export type ProviderGroupId = 'recommended' | 'popular' | 'local' | 'more'
export type PurposeId = 'analysis' | 'vision' | 'asr' | 'image'

export type ProviderPreset = {
  id: string
  kind: string
  display_name: string
  ui_name: string
  short_name: string
  group: ProviderGroupId
  protocol: string
  base_url: string
  auth: string
  capabilities: string[]
  docs_url: string
  locked: boolean
  accepted_hosts: string[]
  default_model: string
  candidates: Record<PurposeId, string[]>
  openai_compat_remap: boolean
  local_compat_remap: boolean
  legacy_ui: boolean
  api_key_setting: string
  placeholder: string
  hint: string
  context_hint: string
  local_app: string
  sponsor?: { register_url: string; guide_url: string; offer: string; description: string; topup_url?: string }
  referral: string
  success_tier?: SuccessTier
  latency_tier?: LatencyTier
  caveat_key?: string
}

export type ProviderCatalog = {
  schema_version: number
  version: number
  issued_at: string
  local_context_hint: string
  console_hosts: string[]
  console_suffixes: string[]
  aliases: Record<string, string>
  providers: Record<string, ProviderPreset>
}

const PURPOSES: PurposeId[] = ['analysis', 'vision', 'asr', 'image']
const GROUPS = new Set<ProviderGroupId>(['recommended', 'popular', 'local', 'more'])

const ENGLISH_PROVIDER_NAMES: Record<string, string> = {
  apimart: 'APIMart',
  api88: '88API',
  infistar: 'Infistar',
  deepseek: 'DeepSeek',
  dashscope: 'Alibaba Cloud Model Studio',
  siliconflow: 'SiliconFlow',
  seed: 'ByteDance Seed',
  glm: 'Zhipu GLM',
  kimi: 'Moonshot Kimi',
  'minimax-cn': 'MiniMax',
  xiaomi: 'Xiaomi MiMo',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  whisper: 'Whisper',
  sensevoice: 'SenseVoice',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  grok: 'xAI Grok',
  groq: 'Groq',
  mistral: 'Mistral',
  together: 'Together AI',
  fireworks: 'Fireworks AI',
  huggingface: 'Hugging Face',
  nvidia: 'NVIDIA NIM',
  cerebras: 'Cerebras',
  baseten: 'Baseten',
  'azure-openai': 'Azure OpenAI',
  'amazon-bedrock': 'Amazon Bedrock',
  'google-vertex': 'Google Vertex AI',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  moonshotai: 'Moonshot AI',
  minimax: 'MiniMax International',
  'ant-ling': 'Ant Ling',
  qianfan: 'Baidu Qianfan',
  hunyuan: 'Tencent Hunyuan',
  'byteplus-modelark': 'BytePlus ModelArk',
}

const ENGLISH_PROVIDER_HINTS: Record<string, string> = {
  apimart: 'Connect using an APIMart API key.',
  api88: 'Connect using an 88API API key.',
  infistar: 'Connect using an Infistar API key. Supports Claude, GPT, Gemini, and DeepSeek.',
  deepseek: 'Direct DeepSeek access. Includes the current DeepSeek model lineup.',
  dashscope: 'Connect to Alibaba Cloud Model Studio using a DashScope API key.',
  siliconflow: 'Connect to SiliconFlow using its OpenAI-compatible API.',
  seed: 'Connect to ByteDance Seed and explore the Seed model lineup.',
  glm: 'Connect to Zhipu GLM using an API key.',
  kimi: 'Connect to Moonshot Kimi using an API key.',
  ollama: 'Run models locally with Ollama. Install Ollama, then run `ollama pull qwen2.5:7b`.',
  lmstudio: 'Run models locally with LM Studio. Enable its Local Server feature first.',
  whisper: 'Use local Whisper speech recognition. Install the transcription component to get started.',
  sensevoice: 'Use local SenseVoice speech recognition. Install the transcription component to get started.',
}

const ENGLISH_CONTEXT_HINTS: Record<string, string> = {
  ollama: "For long videos, raise the context to 16384 or more (OLLAMA_CONTEXT_LENGTH environment variable or the model's num_ctx), or the start of the transcript gets cut off.",
  lmstudio: 'For long videos, set Context Length to 16384 or more when loading the model in LM Studio, or requests fail or the transcript gets cut.',
}

function providerName(id: string, value: string): string {
  return ENGLISH_PROVIDER_NAMES[id] || value.replace(/[（(].*[）)]/g, '').trim() || id
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function parseProvider(id: string, rawProvider: unknown): ProviderPreset | undefined {
  if (!id || !rawProvider || typeof rawProvider !== 'object') return undefined
  const row = rawProvider as Record<string, unknown>
  if (row.kind !== 'preset') return undefined
  if (typeof row.display_name !== 'string' || !row.display_name.trim()) return undefined
  if (typeof row.group !== 'string' || !GROUPS.has(row.group as ProviderGroupId)) return undefined
  if (typeof row.protocol !== 'string' || !row.protocol.trim()) return undefined
  const candidatesRaw = row.candidates && typeof row.candidates === 'object' ? row.candidates as Record<string, unknown> : {}
  const candidates = Object.fromEntries(PURPOSES.map(purpose => [purpose, asStrings(candidatesRaw[purpose])])) as Record<PurposeId, string[]>
  const sponsorRaw = row.sponsor && typeof row.sponsor === 'object' ? row.sponsor as Record<string, unknown> : undefined
  const sponsor = sponsorRaw && ['register_url', 'guide_url', 'offer', 'description'].every(key => typeof sponsorRaw[key] === 'string')
    ? {
        register_url: String(sponsorRaw.register_url),
        guide_url: String(sponsorRaw.guide_url),
        offer: id === 'api88' ? 'Starter credit' : id === 'infistar' ? '$5 in free trial credit' : 'Free API key',
        description: id === 'api88'
          ? 'Sign up through the referral link to receive starter credit.'
          : id === 'infistar'
            ? 'Sign up through the referral link to receive $5 in free trial credit.'
            : 'Create an API key through the referral link.',
        ...(typeof sponsorRaw.topup_url === 'string' && sponsorRaw.topup_url.trim()
          ? { topup_url: String(sponsorRaw.topup_url).trim() }
          : {}),
      }
    : undefined
  const display = providerName(id, row.display_name.trim())
  const uiName = providerName(id, typeof row.ui_name === 'string' ? row.ui_name.trim() : display)
  const shortName = providerName(id, typeof row.short_name === 'string' ? row.short_name.trim() : display)
  const hint = ENGLISH_PROVIDER_HINTS[id] || `Connect to ${display} using its API.`
  const contextHint = ENGLISH_CONTEXT_HINTS[id] || ''
  const quality = qualityFor(id)
  return {
    id,
    kind: 'preset',
    display_name: display,
    ui_name: uiName,
    short_name: shortName,
    group: row.group as ProviderGroupId,
    protocol: row.protocol.trim(),
    base_url: String(row.base_url || '').trim(),
    auth: String(row.auth || 'api_key').trim(),
    capabilities: asStrings(row.capabilities),
    docs_url: String(row.docs_url || '').trim(),
    locked: Boolean(row.locked),
    accepted_hosts: asStrings(row.accepted_hosts).map(host => host.toLowerCase()),
    default_model: typeof row.default_model === 'string' ? row.default_model : (candidates.analysis[0] || ''),
    candidates,
    openai_compat_remap: Boolean(row.openai_compat_remap),
    local_compat_remap: Boolean(row.local_compat_remap),
    legacy_ui: Boolean(row.legacy_ui),
    api_key_setting: String(row.api_key_setting || `${id}_api_key`),
    placeholder: String(row.placeholder || 'sk-…'),
    hint,
    context_hint: contextHint,
    local_app: String(row.local_app || ''),
    sponsor,
    referral: typeof row.referral === 'string' ? row.referral.trim() : '',
    ...(quality ? {
      success_tier: quality.success_tier,
      latency_tier: quality.latency_tier,
      ...(quality.caveat_key ? { caveat_key: quality.caveat_key } : {}),
    } : {}),
  }
}

function parseCatalog(document: unknown): ProviderCatalog {
  if (!document || typeof document !== 'object') throw new Error('provider presets must be an object')
  const data = document as Record<string, unknown>
  if (data.schema_version !== 1) throw new Error(`unsupported provider presets schema_version: ${String(data.schema_version)}`)
  const rawProviders = data.providers && typeof data.providers === 'object' ? data.providers as Record<string, unknown> : {}
  const providers: Record<string, ProviderPreset> = {}
  for (const [id, value] of Object.entries(rawProviders)) {
    const parsed = parseProvider(id, value)
    if (parsed) providers[parsed.id] = parsed
  }
  const aliases: Record<string, string> = {}
  if (data.aliases && typeof data.aliases === 'object') {
    for (const [alias, target] of Object.entries(data.aliases as Record<string, unknown>)) {
      if (typeof target === 'string' && target.trim()) aliases[alias.trim().toLowerCase()] = target.trim()
    }
  }
  const addressRules = (data.address_rules || {}) as Record<string, unknown>
  return {
    schema_version: 1,
    console_hosts: asStrings(addressRules.console_hosts),
    console_suffixes: asStrings(addressRules.console_suffixes),
    version: typeof data.version === 'number' ? data.version : 1,
    issued_at: String(data.issued_at || ''),
    local_context_hint: 'Local or LAN model: for long videos, raise the context length to 16384 or more, or the transcript gets cut.',
    aliases,
    providers,
  }
}

const catalog = parseCatalog(raw)

export function getCatalog(): ProviderCatalog {
  return catalog
}

export function resolveProviderId(name?: string): string | undefined {
  if (!name) return undefined
  const key = catalog.aliases[name.trim().toLowerCase()] || name.trim().toLowerCase()
  return key in catalog.providers ? key : undefined
}

export function getProvider(name?: string): ProviderPreset | undefined {
  const key = resolveProviderId(name)
  return key ? catalog.providers[key] : undefined
}

export function analysisCandidates(name?: string): string[] {
  return getProvider(name)?.candidates.analysis || []
}

export function visionCandidates(name?: string): string[] {
  return getProvider(name)?.candidates.vision || []
}

export function imageCandidates(name?: string): string[] {
  return getProvider(name)?.candidates.image || []
}

export function asrCandidates(name?: string): string[] {
  return getProvider(name)?.candidates.asr || []
}
