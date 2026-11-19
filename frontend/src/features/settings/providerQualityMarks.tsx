import { t } from '../../i18n'
import type { LatencyTier, SuccessTier } from './providerQuality'

type Marks = {
  success_tier?: SuccessTier
  latency_tier?: LatencyTier
  caveat_key?: string
}

function successLabel(tier: SuccessTier): string {
  if (tier === 'high') return t('Measured success: high')
  if (tier === 'mid') return t('Measured success: medium')
  return t('Measured success: low')
}

function latencyLabel(tier: LatencyTier): string {
  if (tier === 'under_5m') return t('Typical time: < 5 min')
  if (tier === 'mid_5_20m') return t('Typical time: 5–20 min')
  return t('Typical time: > 20 min')
}

/** Muted chips plus an optional fixed caveat. No color by tier. */
export default function ProviderQualityMarks({ preset }: { preset: Marks }) {
  if (!preset.success_tier && !preset.latency_tier && !preset.caveat_key) return null
  return (
    <>
      {(preset.success_tier || preset.latency_tier) && (
        <span className="ac-provider-caps">
          {preset.success_tier && (
            <span className="ac-provider-cap" data-success-tier={preset.success_tier}>{successLabel(preset.success_tier)}</span>
          )}
          {preset.latency_tier && (
            <span className="ac-provider-cap" data-latency-tier={preset.latency_tier}>{latencyLabel(preset.latency_tier)}</span>
          )}
        </span>
      )}
      {preset.caveat_key && (
        <span className="ac-note" data-caveat-key={preset.caveat_key}>{t(preset.caveat_key)}</span>
      )}
    </>
  )
}
