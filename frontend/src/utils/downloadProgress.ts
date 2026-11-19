/**
 * Video sourceDownloadProgress。
 *
 * List/DetailsInterface handle processing_config Serialize into settings，NoBack processing_config。
 * Use `processing_config.download_progress || 0` TimeProgressHas always been 0，PendingProjectWill be
 * ProjectThe card is hard-coded. 5%（「Importing」），Looks likeDownloadStopGet it from the 5%。
 * Progress 0 and download_status is downloading It also counts as positive.Get it from theDownload，Not usable > 0 Filter out the starting point。
 */

export interface DownloadFields {
  download_progress?: number | null
  download_status?: string | null
}

export interface DownloadProjectLike {
  status?: string | null
  processing_config?: DownloadFields | null
  settings?: DownloadFields | null
}

function hasDownloadFields(bag?: DownloadFields | null): bag is DownloadFields {
  return !!bag && (bag.download_progress != null || typeof bag.download_status === 'string')
}

export function downloadFields(project: DownloadProjectLike): DownloadFields | undefined {
  if (hasDownloadFields(project.processing_config)) return project.processing_config
  if (hasDownloadFields(project.settings)) return project.settings
  return undefined
}

export function readDownloadProgress(project: DownloadProjectLike): number {
  const raw = downloadFields(project)?.download_progress
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

/**
 * DownloadclipsThe hundred that should be drawn abovepointsCompare。
 *
 * Import linkIt will first be inserted into one that doesn't haveDownloadCharacterclipsof pending Card，ProgressDrawn as 5%。
 * ListBring back later 0、30 This kind of realProgressTime，Must follow props Go。
 * Polling hasn't started yetSuccess（Desktop access to the shell page、RequestFailed）Cannot stop at this timeGet it from theFirst time 5。
 */
export function displayedDownloadPercent(propPercent: number, polledPercent: number | null): number {
  if (typeof polledPercent === 'number' && Number.isFinite(polledPercent)) return polledPercent
  return typeof propPercent === 'number' && Number.isFinite(propPercent) ? propPercent : 0
}

export function isSourceDownloading(project: DownloadProjectLike): boolean {
  const status = project.status
  if (status !== 'pending' && status !== 'downloading') return false
  const fields = downloadFields(project)
  if (!fields) return false
  const progress = readDownloadProgress(project)
  if (progress >= 100) return false
  if (fields.download_status === 'downloading') return true
  return progress > 0
}
