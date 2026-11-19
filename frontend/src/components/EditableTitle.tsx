import { t } from '../i18n'
import { useTranslation } from 'react-i18next'
import React, { useState, useRef, useEffect } from 'react'
import { Input, Button, Space, message, Tooltip, Modal } from 'antd'
import { EditOutlined, CheckOutlined } from '@ant-design/icons'
import { projectApi } from '../services/api'
import MagicWandIcon from './icons/MagicWandIcon'

interface EditableTitleProps {
  title: string
  clipId: string
  onTitleUpdate?: (newTitle: string) => void
  maxLength?: number
  style?: React.CSSProperties
  className?: string
}

const EditableTitle: React.FC<EditableTitleProps> = ({
  title,
  clipId,
  onTitleUpdate,
  maxLength = 200,
  style,
  className
}) => {
  useTranslation()
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(title)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const inputRef = useRef<any>(null)

  // When externaltitleWhen there is a change，Sync internallyStatus
  useEffect(() => {
    setEditValue(title)
  }, [title])

  // WhentitleWhen there is a change，If notGet it from theEditMode，EnsureShowLatest value
  useEffect(() => {
    if (!isEditing) {
      setEditValue(title)
    }
  }, [title, isEditing])

  // EnterEditIn modeSpotlightInput field
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      // TextAreaComponent does not haveselectMethod，UsesetSelectionRangeReplace
      if (inputRef.current.setSelectionRange) {
        inputRef.current.setSelectionRange(0, inputRef.current.value.length)
      }
    }
  }, [isEditing])

  const handleStartEdit = () => {
    setEditValue(title)
    setIsEditing(true)
  }

  const handleCancel = () => {
    setEditValue(title)
    setIsEditing(false)
  }

  const handleSave = async () => {
    const trimmedValue = editValue.trim()
    
    if (!trimmedValue) {
      message.error(t("Title cannot be empty"))
      return
    }
    
    if (trimmedValue.length > maxLength) {
      message.error(t("Title must be at most {{value1}} characters", { value1: maxLength }))
      return
    }
    
    if (trimmedValue === title) {
      setIsEditing(false)
      return
    }

    setLoading(true)
    try {
      await projectApi.updateClipTitle(clipId, trimmedValue)
      message.success(t("Title updated"))
      setIsEditing(false)
      // Update firstLocalStatus, thenInvoke callback
      onTitleUpdate?.(trimmedValue)
    } catch (error: any) {
      console.error('Could not update title:', error)
      message.error(error.userMessage || error.message || t("Could not update title"))
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateTitle = async () => {
    console.log('Start generatingTitle，clipId:', clipId)
    setGenerating(true)
    try {
      const result = await projectApi.generateClipTitle(clipId)
      console.log('GenerateTitleResult:', result)
      if (result.success && result.generated_title) {
        setEditValue(result.generated_title)
        message.success(t("Title generated. Edit it or save when ready."))
      } else {
        message.error(t("Title generation failed"))
      }
    } catch (error: any) {
      console.error('Could not generate title:', error)
      message.error(error.userMessage || error.message || t("Could not generate title"))
    } finally {
      setGenerating(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  if (isEditing) {
    return (
      <Modal
        title={t("Edit title")}
        open={isEditing}
        onCancel={handleCancel}
        footer={null}
        width={600}
        destroyOnClose
        maskClosable={false}
      >
        <div style={{ marginBottom: '16px' }}>
          <Input.TextArea
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyPress}
            maxLength={maxLength}
            placeholder={t("Enter a title")}
            autoSize={{ minRows: 3, maxRows: 8 }}
            style={{ 
              resize: 'none',
              fontSize: '14px',
              lineHeight: '1.5'
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '12px', color: '#666' }}>{t("Characters:")}{editValue.length}/{maxLength}
          </div>
          <Space>
            <Tooltip title={t("Generate title with AI")}>
              <Button
                icon={<MagicWandIcon />}
                loading={generating}
                onClick={() => {
                  console.log('Generate title with AIButton clicked');
                  handleGenerateTitle();
                }}
                disabled={loading}
              >{t("Generate with AI")}</Button>
            </Tooltip>
            <Button onClick={handleCancel} disabled={loading || generating}>{t("Cancel")}</Button>
            <Button
              type="primary"
              icon={<CheckOutlined />}
              loading={loading}
              onClick={handleSave}
              disabled={generating}
            >{t("Save")}</Button>
          </Space>
        </div>
      </Modal>
    )
  }

  return (
    <div
      style={{
        cursor: 'text',
        ...style
      }}
      className={`ac-editable ${className || ''}`}
      onClick={handleStartEdit}
      title={t("Click to edit title")}
    >
      <span style={{ wordBreak: 'break-word', display: 'inline' }}>
        {title}
        <EditOutlined
          className="ac-editable-pen"
          style={{
            color: 'var(--ac-muted)',
            fontSize: '11px',
            opacity: 0,
            transition: 'opacity 0.15s',
            marginLeft: '6px',
            display: 'inline'
          }}
        />
      </span>
    </div>
  )
}

export default EditableTitle
