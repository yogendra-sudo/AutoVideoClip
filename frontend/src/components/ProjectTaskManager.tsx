import { t, getLocale } from '../i18n'
import { useTranslation } from 'react-i18next'
import React, { useState } from 'react'
import { Card, Table, Tag, Progress, Space, Typography, Button, Modal, message, Row, Col, Statistic } from 'antd'
import { ReloadOutlined, EyeOutlined, ExclamationCircleOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { useTaskStatus } from '../hooks/useTaskStatus'
import { TaskStatus as TaskStatusType } from '../hooks/useTaskStatus'

const { Text } = Typography
const { confirm } = Modal

interface ProjectTaskManagerProps {
  projectId: string
  projectName?: string
}

export const ProjectTaskManager: React.FC<ProjectTaskManagerProps> = ({ 
  projectId
}) => {
  useTranslation()
  const { tasks, loading, loadProjectTasks } = useTaskStatus()
  const [selectedTask, setSelectedTask] = useState<TaskStatusType | null>(null)
  const [taskDetailVisible, setTaskDetailVisible] = useState(false)

  // Get currentProjectTask
  const allTasks = tasks || []
  const projectTasks = allTasks.filter((task: TaskStatusType) => task.project_id === projectId)
  const activeTasks = projectTasks.filter((task: TaskStatusType) => 
    task.status === 'running' || task.status === 'pending'
  )
  const completedTasks = projectTasks.filter((task: TaskStatusType) => task.status === 'completed')
  const failedTasks = projectTasks.filter((task: TaskStatusType) => task.status === 'failed')

  // RefreshTaskList
  const handleRefresh = () => {
    loadProjectTasks(projectId)
    message.success(t("Task list refreshed"))
  }

  // ViewTask details
  const handleViewTask = (task: TaskStatusType) => {
    setSelectedTask(task)
    setTaskDetailVisible(true)
  }

  // Delete task
  const handleDeleteTask = (taskId: string) => {
    confirm({
      title: t("Confirm deletion"),
      icon: <ExclamationCircleOutlined />,
      content: t("Delete this task? This cannot be undone."),
      okText: t("Delete"),
      okType: 'danger',
      cancelText: t("Cancel"),
      onOk() {
        message.success(t("Task deleted: {{value1}}", { value1: taskId }))
      }
    })
  }

  // ObtainStatusIcon
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />
      case 'running':
        return <ClockCircleOutlined style={{ color: '#1890ff' }} />
      case 'failed':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
      case 'pending':
        return <ClockCircleOutlined style={{ color: '#faad14' }} />
      default:
        return <ClockCircleOutlined style={{ color: '#d9d9d9' }} />
    }
  }

  // Table column definition
  const columns = [
    {
      title: t("Task name"),
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: TaskStatusType) => (
        <Space>
          {getStatusIcon(record.status)}
          <Text strong>{text}</Text>
        </Space>
      )
    },
    {
      title: t("Status"),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'completed' ? 'success' : status === 'running' ? 'processing' : status === 'failed' ? 'error' : status === 'pending' ? 'warning' : 'default'}>
          {status === 'completed' ? t("Completed") :
           status === 'running' ? t("Running") :
           status === 'failed' ? t("Failed") :
           status === 'pending' ? t("Waiting") : status}
        </Tag>
      )
    },
    {
      title: t("Progress"),
      dataIndex: 'progress',
      key: 'progress',
      render: (progress: number, record: TaskStatusType) => (
        <Progress 
          percent={Math.round(progress)} 
          size="small"
          status={record.status === 'failed' ? 'exception' : 'normal'}
        />
      )
    },
    {
      title: t("Current step"),
      dataIndex: 'current_step',
      key: 'current_step',
      render: (step: string) => step || '-'
    },
    {
      title: t("Created"),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (timestamp: string) => (
        <Text type="secondary">
          {new Date(timestamp).toLocaleString(getLocale())}
        </Text>
      )
    },
    {
      title: t("Actions"),
      key: 'actions',
      width: 120,
      render: (_: any, record: TaskStatusType) => (
        <Space size="small">
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewTask(record)}
            title={t("View details")}
          />
          <Button
            type="text"
            size="small"
            icon={<ExclamationCircleOutlined />}
            onClick={() => handleDeleteTask(record.id)}
            title={t("Delete task")}
            danger
          />
        </Space>
      )
    }
  ]

  if (projectTasks.length === 0) {
    return (
      <Card title={t("Task manager")} size="small">
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <Text type="secondary">{t("No tasks for this project")}</Text>
        </div>
      </Card>
    )
  }

  return (
    <Card 
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t("Task manager")}</span>
          <Button 
            type="primary" 
            size="small"
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            loading={loading}
          >{t("Refresh")}</Button>
        </div>
      }
      size="small"
    >
      {/* Task Statistics */}
      <Row gutter={16} style={{ marginBottom: '16px' }}>
        <Col span={6}>
          <Statistic
            title={t("Total tasks")}
            value={projectTasks.length}
            prefix={<ClockCircleOutlined />}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title={t("Active tasks")}
            value={activeTasks.length}
            valueStyle={{ color: '#1890ff' }}
            prefix={<ClockCircleOutlined />}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title={t("Completed")}
            value={completedTasks.length}
            valueStyle={{ color: '#52c41a' }}
            prefix={<CheckCircleOutlined />}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title={t("Failed tasks")}
            value={failedTasks.length}
            valueStyle={{ color: '#ff4d4f' }}
            prefix={<CloseCircleOutlined />}
          />
        </Col>
      </Row>

      {/* Active tasks */}
      {activeTasks.length > 0 && (
        <Card 
          size="small" 
          style={{ marginBottom: '16px' }}
          title={t("Active tasks ({{value1}})", { value1: activeTasks.length })}
        >
          <Space wrap>
            {activeTasks.map((task: TaskStatusType) => (
              <div key={task.id} style={{ marginBottom: '8px' }}>
                <Text>{task.message || task.id}</Text>
                <Progress percent={task.progress} size="small" />
              </div>
            ))}
          </Space>
        </Card>
      )}

      {/* TaskList */}
      <Table
        columns={columns}
        dataSource={projectTasks}
        rowKey="id"
        pagination={{
          pageSize: 5,
          showSizeChanger: false,
          showTotal: (total, range) => 
            t("{{value1}}–{{value2}} of {{value3}}", { value1: range[0], value2: range[1], value3: total })
        }}
        size="small"
        loading={loading}
      />

      {/* Task detailsPop-up window */}
      <Modal
        title={t("Task details")}
        open={taskDetailVisible}
        onCancel={() => setTaskDetailVisible(false)}
        footer={[
          <Button key="close" onClick={() => setTaskDetailVisible(false)}>{t("Close")}</Button>
        ]}
        width={800}
      >
        {selectedTask && (
          <div>
            <Text>{t("Task ID:")}{selectedTask.id}</Text>
            <br />
            <Text>{t("Status:")}{selectedTask.status}</Text>
            <br />
            <Text>{t("Progress:")}{selectedTask.progress}%</Text>
            <br />
            <Text>{t("Message:")}{selectedTask.message}</Text>
          </div>
        )}
      </Modal>
    </Card>
  )
}
