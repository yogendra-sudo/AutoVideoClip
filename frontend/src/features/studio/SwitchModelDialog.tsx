import { useMemo, useState } from 'react'
import { t } from '../../i18n'
import { Btn, Dialog } from '../../ui'
import ProviderQualityMarks from '../settings/providerQualityMarks'
import { defaultSwitchOption, type SwitchModelOption } from './switchModelOptions'

export default function SwitchModelDialog({
  open,
  options,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean
  options: SwitchModelOption[]
  busy?: boolean
  onClose: () => void
  onConfirm: (choice: { connectionId: string; model: string }) => void
}) {
  const initial = useMemo(() => defaultSwitchOption(options), [options])
  const [selected, setSelected] = useState<string | null>(null)
  const keyOf = (o: SwitchModelOption) => `${o.connectionId}::${o.model}`
  const currentKey = selected ?? (initial ? keyOf(initial) : null)
  const current = options.find(o => keyOf(o) === currentKey) || initial

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('Try another model')}
      description={t('Pick a tested connection to continue. The highest success rate is selected by default.')}
      footer={
        <div className="studio-actions">
          <Btn disabled={busy} onClick={onClose}>{t('Cancel')}</Btn>
          <Btn
            variant="cta"
            disabled={busy || !current}
            loading={busy}
            onClick={() => current && onConfirm({ connectionId: current.connectionId, model: current.model })}
          >
            {t('Switch and retry')}
          </Btn>
        </div>
      }
    >
      {!options.length ? (
        <p className="studio-muted">{t('No other usable connections yet. Add and test a provider in Settings first.')}</p>
      ) : (
        <ul className="studio-switch-model-list" role="listbox" aria-label={t('Available models')}>
          {options.map(option => {
            const key = keyOf(option)
            const checked = key === currentKey
            return (
              <li key={key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={checked}
                  className={`studio-switch-model-option${checked ? ' is-selected' : ''}`}
                  onClick={() => setSelected(key)}
                  disabled={busy}
                >
                  <span className="studio-switch-model-name">
                    <strong>{option.displayName}</strong>
                    <span className="studio-muted">{option.model}</span>
                  </span>
                  <ProviderQualityMarks preset={{ success_tier: option.success_tier }} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Dialog>
  )
}
