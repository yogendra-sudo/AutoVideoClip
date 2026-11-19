import { t } from '../i18n'
import { useTranslation } from 'react-i18next'
import React, { useState, useEffect } from 'react'
import { Modal, Row, Col, Button, Space, Typography, Tag, message, Popconfirm } from 'antd'
import { PlayCircleOutlined, DeleteOutlined, MenuOutlined, CloseOutlined, LeftOutlined, RightOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd'
import { Collection, Clip, useProjectStore } from '../store/useProjectStore'
import { projectApi } from '../services/api'
import AddClipToCollectionModal from './AddClipToCollectionModal'
import { useCollectionVideoDownload } from '../hooks/useCollectionVideoDownload'
import EditableTitle from './EditableTitle'
import ClipVideo from './ClipVideo'
import './CollectionPreviewModal.css'

const { Title, Text } = Typography

interface CollectionPreviewModalProps {
  visible: boolean
  collection: Collection | null
  clips: Clip[]
  projectId: string
  onClose: () => void
  onUpdateCollection: (collectionId: string, updates: Partial<Collection>) => void
  onRemoveClip: (collectionId: string, clipId: string) => Promise<void>
  onReorderClips: (collectionId: string, newClipIds: string[]) => void
  onAddClip?: (collectionId: string, clipIds: string[]) => void
  onDelete?: (collectionId: string) => void
}

const CollectionPreviewModal: React.FC<CollectionPreviewModalProps> = ({
  visible,
  collection,
  clips,
  projectId,
  onClose,
  onRemoveClip,
  onReorderClips,
  onAddClip,
  onDelete
}) => {
  useTranslation()
  const [currentClipIndex, setCurrentClipIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const autoPlay = true

  const [showAddClipModal, setShowAddClipModal] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const { setDragging } = useProjectStore()
  const { isGenerating, generateAndDownloadCollectionVideo } = useCollectionVideoDownload()

  // FromstoreGet the latest fromcollectionStatus
  const { projects, currentProject, lastEditTimestamp } = useProjectStore()
  const latestCollection = collection ? 
    (currentProject?.collections?.find(c => c.id === collection.id) || 
     projects.find(p => p.collections?.some(c => c.id === collection.id))?.collections?.find(c => c.id === collection.id) ||
     collection) : null

  // According tolatestCollection.clip_idsSequential arrangement ofclips
  const collectionClips = latestCollection ? 
    (Array.isArray(latestCollection.clip_ids) ? latestCollection.clip_ids : [])
      .map(clipId => (Array.isArray(clips) ? clips : []).find(clip => clip.id === clipId))
      .filter(Boolean) as Clip[] : []
  const currentClip = collectionClips[currentClipIndex]

  useEffect(() => {
    if (visible && collectionClips.length > 0) {
      setCurrentClipIndex(0)
      setPlaying(false)
    }
  }, [visible, latestCollection, collectionClips.length, lastEditTimestamp])

  const handleClipSelect = (index: number) => {
    setCurrentClipIndex(index)
    setPlaying(true)
  }

  const handlePlayNext = () => {
    if (currentClipIndex < collectionClips.length - 1) {
      setCurrentClipIndex(currentClipIndex + 1)
      if (autoPlay) {
        setPlaying(true)
      }
    } else {
      setPlaying(false)
    }
  }

  const handlePlayPrevious = () => {
    if (currentClipIndex > 0) {
      setCurrentClipIndex(currentClipIndex - 1)
      if (autoPlay) {
        setPlaying(true)
      }
    }
  }

  const handleVideoEnd = () => {
    if (autoPlay && currentClipIndex < collectionClips.length - 1) {
      handlePlayNext()
    } else {
      setPlaying(false)
    }
  }

  const handleDragStart = () => {
    console.log('Drag and drop started')
    setDragging(true)
  }

  const handleDragEnd = async (result: DropResult) => {
    console.log('Drag and drop ended:', result)
    
    // Clear the drag regardlessStatus
    setDragging(false)
    
    if (!result.destination || !latestCollection) {
      console.log('Drag and dropCancelor no target location')
      return
    }

    // Check if there is really a change in position
    if (result.source.index === result.destination.index) {
      console.log('Position unchanged，Skip update')
      return
    }

    const newClipIds = Array.from(latestCollection.clip_ids)
    const [reorderedItem] = newClipIds.splice(result.source.index, 1)
    newClipIds.splice(result.destination.index, 0, reorderedItem)

    console.log('Original order:', latestCollection.clip_ids)
    console.log('New order:', newClipIds)
    
    // ShowLoadStatus
    const hideLoading = message.loading(t("Updating clip order…"), 0)
    setIsUpdating(true)
    
    try {
      await onReorderClips(latestCollection.id, newClipIds)
      
      // Update currentPlayIndex
      const currentClipId = collectionClips[currentClipIndex]?.id
      if (currentClipId) {
        const newIndex = newClipIds.indexOf(currentClipId)
        setCurrentClipIndex(newIndex)
      }
      
      hideLoading()
    } catch (error) {
      console.error('Failed to reorder clips:', error)
      hideLoading()
      message.error(t("Could not reorder clips"))
    } finally {
      setIsUpdating(false)
    }
  }

  const handleRemoveClip = async (clipId: string) => {
    if (!latestCollection) return
    
    const hideLoading = message.loading(t("Removing clip…"), 0)
    setIsUpdating(true)
    
    try {
      await onRemoveClip(latestCollection.id, clipId)
      
      // Adjust currentPlayIndex
      const removedIndex = latestCollection.clip_ids.indexOf(clipId)
      if (removedIndex <= currentClipIndex && currentClipIndex > 0) {
        setCurrentClipIndex(currentClipIndex - 1)
      } else if (removedIndex === currentClipIndex && currentClipIndex >= collectionClips.length - 1) {
        setCurrentClipIndex(Math.max(0, collectionClips.length - 2))
      }
      
      hideLoading()
    } catch (error) {
      console.error('Failed to remove clip:', error)
      hideLoading()
      message.error(t("Could not remove clip"))
    } finally {
      setIsUpdating(false)
    }
  }

  const handleGenerateVideo = async () => {
    if (!latestCollection) return
    
    await generateAndDownloadCollectionVideo(
      projectId, 
      latestCollection.id, 
      latestCollection.collection_title
    )
  }

  const handleAddClips = async (selectedClipIds: string[]) => {
    if (!latestCollection || !onAddClip) return
    
    const hideLoading = message.loading(t("Adding clips…"), 0)
    setIsUpdating(true)
    
    try {
      await onAddClip(latestCollection.id, selectedClipIds)
      setShowAddClipModal(false)
      hideLoading()
    } catch (error) {
      console.error('Failed to add clips:', error)
      hideLoading()
      message.error(t("Could not add clip"))
    } finally {
      setIsUpdating(false)
    }
  }

  const formatDuration = (clip: Clip) => {
    const start = clip.start_time.split(':')
    const end = clip.end_time.split(':')
    const startSeconds = parseInt(start[0]) * 3600 + parseInt(start[1]) * 60 + parseFloat(start[2].replace(',', '.'))
    const endSeconds = parseInt(end[0]) * 3600 + parseInt(end[1]) * 60 + parseFloat(end[2].replace(',', '.'))
    const duration = endSeconds - startSeconds
    const mins = Math.floor(duration / 60)
    const secs = Math.floor(duration % 60)
    return `${mins}:${String(secs).padStart(2, '0')}`
  }

  if (!latestCollection) return null

  return (
    <Modal
      title={null}
      open={visible}
      onCancel={onClose}
      footer={null}
      width="90vw"
      style={{ top: 20 }}
      styles={{ body: { padding: 0, height: 'min(90dvh, calc(100dvh - 40px))' } }}
      className="collection-preview-modal"
      closable={false}
      maskClosable={false}
      destroyOnClose={false}
      getContainer={false}
    >
      <div className="collection-preview-container">
        {/* HeaderTitleColumn */}
        <div className="preview-header">
          <div className="header-left">
            <Title level={4} style={{ margin: 0, color: 'var(--ac-ink)', display: 'inline-block', marginRight: '12px' }}>
              {latestCollection.collection_title}
            </Title>
            <Text style={{ color: 'var(--ac-sub)', fontSize: '13px' }}>
              ({t("Clips: {{count}}", { count: collectionClips.length })})</Text>
          </div>
          <div className="header-right">
            <Space>
              <Button 
                type="primary" 
                loading={isGenerating}
                onClick={handleGenerateVideo}
              >{t("Export full video")}</Button>
              <Button 
                type="default" 
                icon={<UploadOutlined />}
                onClick={() => message.info(t("Under development"), 3)}
              >{t("Publish to Bilibili")}</Button>
              {onDelete && (
                <Popconfirm
                  title={t("Delete collection")}
                  description={t("Delete this collection? This cannot be undone.")}
                  onConfirm={() => onDelete(latestCollection.id)}
                  okText={t("Confirm")}
                  cancelText={t("Cancel")}
                >
                  <Button 
                    type="text" 
                    icon={<DeleteOutlined />}
                    style={{ color: 'var(--ac-error)' }}
                  >{t("Delete")}</Button>
                </Popconfirm>
              )}
              <Button 
                type="text" 
                icon={<CloseOutlined />} 
                onClick={onClose}
                aria-label={t("Close collection preview")}
                title={t("Close")}
                style={{
                  color: 'var(--ac-ink)',
                  border: '1px solid var(--ac-line)',
                  background: 'var(--ac-card)',
                }}
              />
            </Space>
          </div>
        </div>

        {/* Main content */}
        <div className="preview-content">
          <Row style={{ height: '100%' }}>
            {/* Left sideVideoPlayDevice */}
            <Col span={16} className="video-section">
              <div className="video-player-wrapper">
                <div className="video-container">
                  {currentClip ? (
                    <ClipVideo
                      url={projectApi.getClipVideoUrl(projectId, currentClip.id, currentClip.title || currentClip.generated_title)}
                      playing={playing}
                      onEnded={handleVideoEnd}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                    />
                  ) : (
                    <div className="empty-video">
                      <PlayCircleOutlined style={{ fontSize: '64px', color: '#d9d9d9' }} />
                      <Text style={{ color: '#999', marginTop: 16 }}>{t("No video content")}</Text>
                    </div>
                  )}
                </div>
                
                {/* VideoInformation bar - Move toVideoBelow */}
                {currentClip && (
                  <div className="video-info-bar">
                    <div className="video-info-content">
                      <div className="video-title-section">
                        <div className="video-title">
                          <EditableTitle
                            title={currentClip.title || currentClip.generated_title || t("Untitled clip")}
                            clipId={currentClip.id}
                            onTitleUpdate={(newTitle) => {
                              // The update callback of the parent component can be triggered here
                              console.log('TitleUpdated:', newTitle)
                            }}
                            style={{ color: 'var(--ac-ink)', fontSize: '16px', fontWeight: '500' }}
                          />
                        </div>
                        <div className="video-meta">
                          <Tag style={{ background: 'var(--ac-line-2)', color: 'var(--ac-sub)', border: '1px solid var(--ac-line)', borderRadius: '6px' }}>
                            <span className="ac-mono">{formatDuration(currentClip)}</span>
                          </Tag>
                          <Tag
                            style={{
                              background: 'var(--ac-line-2)',
                              color: 'var(--ac-ink)',
                              border: '1px solid var(--ac-line)',
                              borderRadius: '6px'
                            }}
                          >
                            <span className="ac-mono">{(currentClip.final_score * 100).toFixed(0)}</span> {t("points")}</Tag>
                          <Text style={{ color: 'var(--ac-muted)', marginLeft: 8 }}>
                            {currentClipIndex + 1} / {collectionClips.length}
                          </Text>
                        </div>
                      </div>
                      
                      <div className="video-controls">
                        <Button 
                          type="text" 
                          icon={<LeftOutlined />}
                          disabled={currentClipIndex === 0}
                          onClick={handlePlayPrevious}
                          title={t("Previous clip")}
                          className="control-btn"
                        />
                        <Button 
                          type="text" 
                          icon={<RightOutlined />}
                          disabled={currentClipIndex === collectionClips.length - 1}
                          onClick={handlePlayNext}
                          title={t("Next clip")}
                          className="control-btn"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Col>

            {/* Right sideClipsList */}
            <Col span={8} className="playlist-section">
              <div className="playlist-container">
                <div className="playlist-header">
                  <div>
                    <Title level={5} style={{ margin: 0 }}>{t("Playlist")}</Title>
                    <Text type="secondary">{t("Drag to reorder")}</Text>
                  </div>
                  {onAddClip && (
                    <Button 
                      type="primary" 
                      size="middle"
                      icon={<PlusOutlined />}
                      onClick={() => setShowAddClipModal(true)}
                      disabled={isUpdating}
                      style={{
                        borderRadius: '999px',
                        background: 'var(--ac-cta-bg)',
                        border: 'none',
                        fontWeight: 500,
                        height: '36px',
                        padding: '0 16px',
                        fontSize: '14px'
                      }}
                    >{t("Add clips")}</Button>
                  )}
                </div>
                
                <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                  <Droppable droppableId="clips">
                    {(provided) => (
                      <div
                        {...provided.droppableProps}
                        ref={provided.innerRef}
                        className="clips-list"
                      >
                        {collectionClips.map((clip, index) => (
                          <Draggable key={clip.id} draggableId={clip.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`clip-item ${
                                  index === currentClipIndex ? 'active' : ''
                                } ${snapshot.isDragging ? 'dragging' : ''}`}
                                onClick={() => {
                                  if (!snapshot.isDragging && !isUpdating) {
                                    handleClipSelect(index)
                                  }
                                }}
                              >
                                <div className="clip-drag-handle">
                                  <MenuOutlined />
                                </div>
                                
                                <div className="clip-content">
                                  <div className="clip-title">
                                    {clip.title || clip.generated_title}
                                  </div>
                                  <div className="clip-meta">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                                      <Text type="secondary">
                                        {formatDuration(clip)}
                                      </Text>
                                      <span className="ac-mono" style={{
                                        background: 'var(--ac-line-2)',
                                        color: 'var(--ac-ink)',
                                        border: '1px solid var(--ac-line)',
                                        padding: '2px 6px',
                                        borderRadius: '6px',
                                        fontSize: '11px'
                                      }}>
                                        {(clip.final_score * 100).toFixed(0)}{t("points")}</span>
                                    </div>
                                  </div>
                                  {clip.recommend_reason && (
                                    <div className="clip-reason">
                                      <Text type="secondary" style={{ fontSize: '11px' }}>
                                        {clip.recommend_reason}
                                      </Text>
                                    </div>
                                  )}
                                </div>

                                <div className="clip-actions">
                                  <Popconfirm
                                    title={t("Remove this clip from the collection?")}
                                    onConfirm={(e) => {
                                      e?.stopPropagation()
                                      handleRemoveClip(clip.id)
                                    }}
                                    okText={t("Confirm")}
                                    cancelText={t("Cancel")}
                                    disabled={isUpdating}
                                  >
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<DeleteOutlined />}
                                      danger
                                      disabled={isUpdating}
                                      onClick={(e) => e.stopPropagation()}
                                      style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'center',
                                        width: '24px',
                                        height: '24px'
                                      }}
                                    />
                                  </Popconfirm>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              </div>
            </Col>
          </Row>
        </div>
      </div>
      
      {/* Add clipsModal box */}
      <AddClipToCollectionModal
        visible={showAddClipModal}
        clips={clips}
        existingClipIds={latestCollection?.clip_ids || []}
        onCancel={() => setShowAddClipModal(false)}
        onConfirm={handleAddClips}
      />

    </Modal>
  )
}

export default CollectionPreviewModal
