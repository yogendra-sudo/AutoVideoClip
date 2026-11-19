import i18n, { t } from '../i18n'
import { useTranslation } from 'react-i18next'
import React, { useCallback, useEffect, useState } from 'react'
import { message } from 'antd'
import { Btn, Icon, Row, Section, Segmented, StatusDot } from '../ui'
import { openExternalLink } from '../utils/externalLinks'
import { publishGuideHref } from '../publish/guide'
import { platformLabel, readApiDetail } from '../publish/uploadPost'
import { bilibiliApi } from '../publish/bilibiliApi'
import { uploadPostApi, type UploadPostConfigView, type UploadPostProfile } from '../publish/uploadPostApi'

const openPublishGuide = () => openExternalLink(publishGuideHref(i18n.language))

const KEY_URL = 'https://app.upload-post.com/api-keys'
const USERS_URL = 'https://app.upload-post.com/manage-users'

const emptyConfig = (): UploadPostConfigView => ({
  configured: false, source: 'none', api_key_masked: '', user: '',
})

const PublishSettings: React.FC = () => {
  useTranslation()
  const [config, setConfig] = useState<UploadPostConfigView>(emptyConfig)
  const [profiles, setProfiles] = useState<UploadPostProfile[]>([])
  const [apiKey, setApiKey] = useState('')
  const [user, setUser] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [biliConfigured, setBiliConfigured] = useState(false)
  const [biliName, setBiliName] = useState('')
  const [biliSource, setBiliSource] = useState('none')
  const [cookie, setCookie] = useState('')
  const [savingBili, setSavingBili] = useState(false)
  const [clearingBili, setClearingBili] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadProfiles = useCallback(async (preferred: string) => {
    const res = await uploadPostApi.profiles()
    const list = res.profiles || []
    setProfiles(list)
    const next = list.some((p) => p.username === preferred) ? preferred : (list[0]?.username || preferred || '')
    setUser(next)
    return list
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cfg, bili] = await Promise.all([uploadPostApi.getConfig(), bilibiliApi.getConfig()])
      setConfig(cfg)
      setUser(cfg.user || '')
      setBiliConfigured(bili.configured)
      setBiliName(bili.nickname || '')
      setBiliSource(bili.source || 'none')
      if (cfg.configured) await loadProfiles(cfg.user || '')
      else setProfiles([])
    } catch (err) {
      setError(readApiDetail(err, t("Publish failed")))
    } finally {
      setLoading(false)
    }
  }, [loadProfiles])

  useEffect(() => { void load() }, [load])

  const selected = profiles.find((p) => p.username === user)
  const connected = (selected?.connected_platforms || []).map(platformLabel).join(' · ')
  const reconnect = (selected?.reconnect_platforms || []).map(platformLabel).join(' · ')

  const save = async () => {
    const key = apiKey.trim()
    const profile = user.trim()
    if (!key && !profile) {
      setError(t("Enter a key, or choose a default profile"))
      return
    }
    if (!config.configured && !key) {
      setError(t("Enter a key, or choose a default profile"))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await uploadPostApi.saveConfig({
        ...(key ? { api_key: key } : {}),
        ...(profile ? { user: profile } : {}),
      })
      setApiKey('')
      setConfig(saved)
      if (saved.configured) await loadProfiles(saved.user || profile)
      const who = key ? saved.account?.email : ''
      message.success(key ? (who ? `${t("Key verified and saved")} · ${who}` : t("Key verified and saved")) : t("Saved"))
    } catch (err) {
      setError(readApiDetail(err, t("Publish failed")))
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    setClearing(true)
    setError(null)
    try {
      await uploadPostApi.clearConfig()
      setApiKey('')
      message.success(t("Removed the key saved on this machine"))
      await load()
    } catch (err) {
      setError(readApiDetail(err, t("Publish failed")))
    } finally {
      setClearing(false)
    }
  }

  const saveBili = async () => {
    const value = cookie.trim()
    if (!value) {
      setError(t("After logging into Bilibili, open Developer Tools → Application → Cookies and copy SESSDATA, bili_jct, and DedeUserID. It stays on this machine."))
      return
    }
    setSavingBili(true)
    setError(null)
    try {
      const saved = await bilibiliApi.saveConfig({ cookie: value })
      setCookie('')
      setBiliConfigured(saved.configured)
      setBiliName(saved.nickname || '')
      setBiliSource(saved.source || 'file')
      message.success(saved.nickname ? `${t("Cookie checked and saved")} · ${saved.nickname}` : t("Cookie checked and saved"))
    } catch (err) {
      setError(readApiDetail(err, t("Publish failed")))
    } finally {
      setSavingBili(false)
    }
  }

  const clearBili = async () => {
    setClearingBili(true)
    setError(null)
    try {
      const cleared = await bilibiliApi.clearConfig()
      setCookie('')
      setBiliConfigured(cleared.configured)
      setBiliName(cleared.nickname || '')
      setBiliSource(cleared.source || 'none')
      message.success(t("Removed the Bilibili account saved on this machine"))
    } catch (err) {
      setError(readApiDetail(err, t("Publish failed")))
    } finally {
      setClearingBili(false)
    }
  }

  return (
    <>
      <Section
        title={t("Bilibili")}
        description={t("Paste the three cookies and save. Bilibili then appears on the publish page.")}
        right={<Btn size="sm" onClick={() => void openPublishGuide()}>{t("How-to")}<Icon.External size={12} /></Btn>}
      >
        <div className="ac-rows">
          <Row
            stack
            top
            label={t("Bilibili cookie")}
            hint={<>
              {t("After logging into Bilibili, open Developer Tools → Application → Cookies and copy SESSDATA, bili_jct, and DedeUserID. It stays on this machine.")}
              {biliConfigured ? ` ${t("Pasting again replaces this account.")}` : ''}
            </>}
          >
            <textarea
              className="ac-input ac-textarea"
              style={{ minHeight: 72, width: '100%' }}
              name="bilibili-cookie"
              autoComplete="off"
              spellCheck={false}
              aria-label={t("Bilibili cookie")}
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
            />
          </Row>
          <Row label={t("Status")} hint={biliSource === 'env' ? t("The cookie comes from an environment variable. A change here will not override it.") : undefined}>
            {loading ? (
              <StatusDot tone="muted" label={t("Still processing")} />
            ) : biliConfigured ? (
              <StatusDot tone="ok" label={t("Connected · {{name}}", { name: biliName || t("Bilibili") })} />
            ) : (
              <StatusDot tone="muted" label={t("Not set up")} />
            )}
          </Row>
          <Row label={t("Save")}>
            <Btn size="sm" variant="cta" loading={savingBili} onClick={() => void saveBili()}>{t("Save and verify")}</Btn>
            {biliSource === 'file' && (
              <Btn size="sm" variant="danger" loading={clearingBili} onClick={() => void clearBili()}>{t("Remove the saved account")}</Btn>
            )}
          </Row>
        </div>
      </Section>
      <Section
        title={t("Overseas")}
        description={t("Add the Upload-Post key here. After that, pick it on the clip’s publish page.")}
      >
        <div className="ac-rows">
          <Row
            wide
            label={t("Publish key")}
            hint={<>
              {t("Create it in Upload-Post. It stays on this machine.")}{' '}
              <a href={KEY_URL} onClick={(e) => { e.preventDefault(); void openExternalLink(KEY_URL) }} style={{ color: 'var(--ac-accent)' }}>{t("Get a key")}</a>
            </>}
          >
            <input
              className="ac-input ac-input--mono"
              type="password"
              name="upload-post-api-key"
              autoComplete="new-password"
              spellCheck={false}
              aria-label={t("Publish key")}
              placeholder={config.api_key_masked || ''}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Row>
          <Row label={t("Status")} hint={config.source === 'env' ? t("The key comes from an environment variable. A change here does not replace it.") : undefined}>
            {loading ? (
              <StatusDot tone="muted" label={t("Still processing")} />
            ) : config.configured ? (
              <StatusDot tone="ok" label={config.api_key_masked ? t("Current key {{key}}", { key: config.api_key_masked }) : t("Configured")} />
            ) : (
              <StatusDot tone="muted" label={t("Not set up")} />
            )}
          </Row>
          <Row
            stack
            label={t("Default profile")}
            hint={<>
              {t("The Upload-Post profile with your social accounts connected.")}{' '}
              <a href={USERS_URL} onClick={(e) => { e.preventDefault(); void openExternalLink(USERS_URL) }} style={{ color: 'var(--ac-accent)' }}>{t("Manage accounts")}</a>
            </>}
          >
            {profiles.length > 0 ? (
              <Segmented
                className="ac-segmented"
                size="sm"
                ariaLabel={t("Default profile")}
                value={user}
                onChange={setUser}
                options={profiles.map((p) => ({ value: p.username, label: p.username }))}
              />
            ) : (
              <span style={{ color: 'var(--ac-sub)', fontSize: 13 }}>{config.configured && !error ? t("No profile yet. Create one in Upload-Post and connect the accounts you want to publish to.") : '—'}</span>
            )}
          </Row>
          {selected && (
            <Row label={t("Connected platforms")} hint={<>
              {connected || t("This profile has no connected platforms.")}
              {reconnect ? ` ${t("Reconnect required: {{platforms}}", { platforms: reconnect })}` : null}
            </>}>
              <Btn size="sm" onClick={() => void loadProfiles(user).catch((err) => setError(readApiDetail(err, t("Publish failed"))))}>{t("Refresh")}</Btn>
            </Row>
          )}
          <Row label={t("Save")}>
            <Btn size="sm" variant="cta" loading={saving} onClick={() => void save()}>{t("Save and verify")}</Btn>
            {config.source === 'file' && (
              <Btn size="sm" variant="danger" loading={clearing} onClick={() => void clear()}>{t("Remove the key saved on this machine")}</Btn>
            )}
          </Row>
        </div>
      </Section>
      {error && <p style={{ marginTop: 12, color: 'var(--ac-error)', fontSize: 13 }}>{error}</p>}
    </>
  )
}

export default PublishSettings
