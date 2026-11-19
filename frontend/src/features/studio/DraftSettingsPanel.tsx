import { Select, Switch } from 'antd'
import { t } from '../../i18n'
import { pipInstallErrorText } from '../../utils/pipInstallError'
import { Btn, ProgressLine, Row, Segmented, StatusDot } from '../../ui'
import { CropPoint, Draft, FramingStatus, Scene, cropAt, frameModeAt, languages, shotIndexAt, subtitleStyles } from './types'
import { titlePresets, titleVersions, isArtworkStyle, titleDesignThumbnails } from './titlePresets'
import PackagingSettings from './PackagingSettings'

const ACCENT_DEFAULT: Record<string, string> = { comic: '#ffe52d', neon: '#ccff00', editorial: '#ff4826', pixel: '#ed327c', frosted: '#00e6dc' }

export interface FramingState {
  status?: FramingStatus
  /** Auto framing is running against the current scenes. */
  busy: boolean
  /** Set after a run: scenes with a track, shots found, and how many shots are shown whole. */
  result?: { framed: number; total: number; shots: number; fit: number }
  error?: string
}

/**
 * Right-hand settings of the Studio editor as one column of setting rows (see DESIGN.md → Row).
 * Top to bottom: name → subtitles (whole clip) → audio → frame + speaker framing → opening title
 * (optional, folded) → text language → cover. Everything has a working default.
 */
export default function DraftSettingsPanel({ draft, patch, scene, currentTime, onShot, framing, onAutoFrame, onInstallFraming, onPortrait, coverHref, onOpenCover }: {
  draft: Draft
  patch: (changes: Partial<Draft>) => void
  /** Scene currently shown in the preview; the framing slider edits this one. */
  scene?: Scene
  currentTime: number
  /** Change the shot under the playhead (position or crop/fit). */
  onShot: (sceneId: string, changes: Partial<CropPoint>) => void
  framing: FramingState
  onAutoFrame: () => void
  onInstallFraming: () => void
  onPortrait: () => void
  coverHref?: string
  onOpenCover: (href: string) => void
}) {
  const artwork = isArtworkStyle(draft.title_style)
  const style = draft.title_style || 'plain'
  const cropping = draft.aspect !== 'original' && draft.layout === 'crop'
  const sceneCrop = cropAt(scene, currentTime, draft.crop_x ?? .5)
  const tracked = !!scene?.crop_track?.length
  const shotMode = frameModeAt(scene, currentTime)
  const shotIndex = shotIndexAt(scene, currentTime)
  const runtime = framing.status?.status
  return <aside className="studio-edit-panel">
    <div className="studio-panel-head">
      <h2>{t("Output settings")}</h2>
      <Btn size="sm" variant="text" onClick={onPortrait}>{t("Portrait preset")}</Btn>
    </div>
    <div className="ac-rows">
      <Row stack label={t("Video name")}>
        <input className="ac-input" aria-label={t("Video name")} maxLength={200} value={draft.title} onChange={e => patch({ title: e.target.value })} />
      </Row>

      {!draft.packaging && <Row label={t("Subtitles")} hint={t("Show subtitles on the video, one look for the whole clip.")}>
        <Switch size="small" checked={draft.subtitles} onChange={value => patch({ subtitles: value })} />
      </Row>}
      {!draft.packaging && draft.subtitles && <Row stack label={t("Subtitle style")}>
        <div className="studio-tiles" role="radiogroup" aria-label={t("Subtitle style")}>
          {subtitleStyles.map(preset => <button type="button" key={preset.value} className="studio-tile" role="radio" aria-checked={(draft.subtitle_style || 'clean') === preset.value} onClick={() => patch({ subtitle_style: preset.value })}>
            <span className="studio-tile-sample"><span className={`studio-caption studio-caption--${preset.value}`}>{t("Subtitle preview")}</span></span>
            <span className="studio-tile-label">{t(preset.label)}</span>
          </button>)}
        </div>
      </Row>}

      <Row label={t("Original audio")} hint={t("Off mutes the final video.")}>
        <Switch size="small" checked={draft.original_audio} onChange={value => patch({ original_audio: value })} />
      </Row>

      <Row label={t("Aspect ratio")}>
        <Segmented size="sm" ariaLabel={t("Aspect ratio")} value={draft.aspect}
          options={[{ value: 'original', label: t("Original aspect ratio") }, { value: 'portrait', label: '9:16' }, { value: 'landscape', label: '16:9' }]}
          onChange={value => patch({ aspect: value, ...(value === 'portrait' ? { layout: 'crop' as const } : {}) })} />
      </Row>
      {draft.aspect !== 'original' && <Row label={t("Framing")} hint={cropping ? t("The subject fills the frame, centred on whoever is speaking.") : t("Keeps the full picture, with bars or a blurred background on the sides.")}>
        <Segmented size="sm" ariaLabel={t("Framing")} value={draft.layout}
          options={[{ value: 'crop', label: t("Fill") }, { value: 'blur', label: t("Blurred background") }, { value: 'fit', label: t("Bars") }]}
          onChange={value => patch({ layout: value })} />
      </Row>}
      {cropping && <Row stack label={t("Framing")} hint={
        runtime === 'not_installed' ? t("First use downloads the person-detection component (about {{size}} MB). After that each shot is framed on the speaker; shots without people (quote cards, slides) are shown whole.", { size: framing.status?.size_mb ?? 45 })
        : runtime === 'installing' ? (framing.status?.message || t("Downloading the person-detection component…"))
        : framing.busy ? t("Locating people shot by shot…")
        : framing.error ? framing.error
        : framing.result ? (framing.result.framed ? t("Framed {{shots}} shots automatically; {{fit}} shots without people are shown whole. Play to a shot to adjust it on its own.", framing.result) : t("No one was detected; adjust the framing manually."))
        : tracked ? t("Framing follows the speaker shot by shot; play to a shot to adjust it on its own.")
        : t("Drag to adjust the framing of the current shot.")}>
        {runtime === 'not_installed' && <Btn size="sm" onClick={onInstallFraming}>{t("Download and auto-frame")}</Btn>}
        {runtime === 'installing' && <ProgressLine percent={framing.status?.progress ?? 5} />}
        {runtime === 'error' && <StatusDot tone="error" label={pipInstallErrorText(t, framing.status)} />}
        {runtime === 'error' && <Btn size="sm" onClick={onInstallFraming}>{t("Reinstall")}</Btn>}
        {runtime === 'installed' && !framing.busy && <Btn size="sm" onClick={onAutoFrame}>{framing.result ? t("Auto-frame again") : t("Auto-frame")}</Btn>}
        {scene && <div className="studio-shot-controls">
          {tracked && <span className="studio-muted ac-mono">{t("Shot {{n}}/{{total}}", { n: shotIndex + 1, total: scene.crop_track!.length })}</span>}
          <Segmented size="sm" ariaLabel={t("How this shot is shown")} value={shotMode} disabled={framing.busy}
            options={[{ value: 'crop', label: t("Follow person") }, { value: 'fit', label: t("Whole frame") }]}
            onChange={value => onShot(scene.id, { mode: value })} />
        </div>}
        <input aria-label={t("Framing position")} type="range" min="0" max="1" step=".01" value={sceneCrop} disabled={framing.busy || shotMode === 'fit'}
          onChange={e => scene ? onShot(scene.id, { crop_x: Number(e.target.value) }) : patch({ crop_x: Number(e.target.value) })} />
      </Row>}

      {draft.packaging ? <PackagingSettings draft={draft} patch={patch} /> : <details className="ac-disclosure" open={!!draft.hook.trim() || undefined}>
        <summary>{t("Opening text (optional)")}</summary>
        <Row stack label={t("Opening text")} hint={t("Large text over the first shot for up to 4 seconds — good for gameplay and promos; leave empty for interviews and explainers.")}>
          <textarea className="ac-input ac-textarea" style={{ minHeight: 56 }} aria-label={t("Opening title text")} maxLength={120} value={draft.hook} placeholder={t("For example: a question, or a one-line takeaway")} onChange={e => patch({ hook: e.target.value })} />
        </Row>
        {!!draft.hook.trim() && <>
          <Row stack label={t("Title style")} hint={t("Thumbnails are design references; the actual text shows in the preview on the left.")}>
            <div className="studio-tiles studio-tiles--3" role="radiogroup" aria-label={t("Title style")}>
              {titlePresets.map(preset => <button type="button" key={preset.value} className="studio-tile" role="radio" aria-checked={style === preset.value}
                onClick={() => patch({ title_style: preset.value, title_template_version: isArtworkStyle(preset.value) ? 6 : 1, title_accent: null })}>
                {titleDesignThumbnails[preset.value]
                  ? <img className="studio-tile-image" src={titleDesignThumbnails[preset.value]} alt="" width={360} height={240} />
                  : <span className="studio-tile-sample studio-tile-sample--center"><span className={`studio-hook studio-hook--${preset.value}`}>{t("Title")}</span></span>}
                <span className="studio-tile-label">{t(preset.label)}</span>
              </button>)}
            </div>
          </Row>
          {artwork && <details className="ac-disclosure">
            <summary>{t("Adjust text style")}</summary>
            <Row label={t("Style version")}>
              <Select aria-label={t("Style version")} size="small" style={{ width: 160 }} value={draft.title_template_version ?? 1}
                options={titleVersions(draft.title_style).map(v => ({ value: v.value, label: t(v.label) }))}
                onChange={value => patch({ title_template_version: value as Draft['title_template_version'] })} />
            </Row>
            <Row label={t("Accent color")}>
              <input type="color" aria-label={t("Title accent color")} value={draft.title_accent || ACCENT_DEFAULT[style] || '#dfff00'} onChange={e => patch({ title_accent: e.target.value })} />
            </Row>
            <Row stack label={t("Text size")}>
              <input type="range" aria-label={t("Text size")} min=".75" max="1.2" step=".05" value={draft.title_scale ?? 1} onChange={e => patch({ title_scale: Number(e.target.value) })} />
            </Row>
            <Row stack label={t("Text position")}>
              <input type="range" aria-label={t("Text position")} min=".06" max=".70" step=".01" value={draft.title_y ?? .12} onChange={e => patch({ title_y: Number(e.target.value) })} />
            </Row>
            {!['pixel', 'frosted'].includes(style) && <Row label={t("Entrance animation")} hint={t("Translation and animation are final in the rendered video; manual line breaks are supported.")}>
              <Switch size="small" checked={draft.title_motion ?? true} onChange={value => patch({ title_motion: value })} />
            </Row>}
          </details>}
        </>}
      </details>}

      {!draft.packaging && <Row label={t("Text language")} hint={t("Choosing a language translates the opening title and subtitles when rendering.")}>
        <Select aria-label={t("Text language")} size="small" style={{ width: 140 }} value={draft.language}
          options={languages.map(l => ({ value: l.value, label: l.value === 'source' ? t('Original language') : l.label }))}
          onChange={value => patch({ language: value as Draft['language'] })} />
      </Row>}
      <Row label={t("Cover")} hint={coverHref ? t("A titled cover is generated per platform when publishing; a video frame works too.") : t("After exporting, generate a titled cover on the publish page.")}>
        {coverHref && <Btn size="sm" variant="text" onClick={() => onOpenCover(coverHref)}>{t("Generate")}</Btn>}
      </Row>
    </div>
  </aside>
}
