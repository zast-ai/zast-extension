<template>
<div class="task-container">
  <div class="task-section">
    <!-- Authentication Status -->
    <div v-if="!isAuthenticated" class="auth-required">
      <div class="auth-message">
        <span class="auth-icon">🔐</span>
        <span>Please log in to view your tasks</span>
      </div>
    </div>

    <div v-else-if="loading" class="loading">Loading...</div>
    <div v-else-if="taskList.length === 0" class="no-data">
      No tasks found
    </div>
    <div v-else class="task-list">
      <div v-for="task in taskList" :key="task.taskId" class="task-item" @click="viewTaskReport(task.taskId)">
        <div class="task-header">
          <div class="task-name">{{ task.projectName }}</div>
          <div class="task-actions">
            <div class="task-date">{{ formatDate(task.createdAt) }}</div>
            <div class="view-report-hint">Click to view report →</div>
          </div>
        </div>
        <div class="task-stats">
          <div class="stat-badges">
            <div class="stat-badge stat-critical" :title="`Critical: ${task.resultsStat.criticalCount}`">
              {{ task.resultsStat.criticalCount }}
            </div>
            <div class="stat-badge stat-high" :title="`High: ${task.resultsStat.highCount}`">
              {{ task.resultsStat.highCount }}
            </div>
            <div class="stat-badge stat-medium" :title="`Medium: ${task.resultsStat.mediumCount}`">
              {{ task.resultsStat.mediumCount }}
            </div>
            <div class="stat-badge stat-low" :title="`Low: ${task.resultsStat.lowCount}`">
              {{ task.resultsStat.lowCount }}
            </div>
          </div>
          <div class="task-status">
            <span class="status-badge" :class="getStatusClass(task.taskStatus)">
              {{ task.taskStatus }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { vscodeApi } from '../../utils/index';

type TaskStatus = 'CREATED' | 'RUNNING' | 'FINISHED' | 'FAILED' | 'SUCCESS';

interface TaskData {
  taskId: string;
  lang: string;
  projectName: string;
  taskStatus: TaskStatus;
  createdAt: string;
  updatedAt: string;
  errCode?: number;
  errDetail?: string;
  resultsStat: {
    total: number;
    lowCount: number;
    highCount: number;
    mediumCount: number;
    criticalCount: number;
    purchased: number;
  };
}

// Reactive state
const loading = ref(true);
const taskList = ref<TaskData[]>([]);
const isAuthenticated = ref(true);

// Format date function
const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(',', '');
};

// Get status class for styling
const getStatusClass = (status: TaskStatus): string => {
  switch (status) {
    case 'FINISHED':
    case 'SUCCESS':
      return 'status-success';
    case 'RUNNING':
      return 'status-progress';
    case 'FAILED':
      return 'status-error';
    case 'CREATED':
      return 'status-created';
    default:
      return 'status-default';
  }
};

// Request task list refresh
const refreshTaskList = () => {
  vscodeApi.post('refreshTaskList', {
    type: 'refreshTaskList'
  });
};

// View task report
const viewTaskReport = (taskId: string) => {
  vscodeApi.post('viewTaskReport', {
    type: 'viewTaskReport',
    data: {
      taskId: taskId
    }
  });
};

// Listen for messages from extension
vscodeApi.on('updateTaskList', (data: { taskList: TaskData[]; timestamp: number }) => {
  console.log('Received updateTaskList:', data);
  taskList.value = data.taskList;
  loading.value = false;
});

// Listen for authentication status changes
vscodeApi.on('authStatusChanged', (data: { isAuthenticated: boolean; provider?: string; message?: string }) => {
  console.log('TaskView: Received authStatusChanged:', data);

  // Update authentication status
  isAuthenticated.value = data.isAuthenticated;

  // If user is not authenticated, clear task list
  if (!data.isAuthenticated) {
    taskList.value = [];
  }
});

// Lifecycle hooks
onMounted(() => {
  // Request initial task list
  refreshTaskList();
});
</script>

<style scoped>
.task-container {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  font-weight: var(--vscode-font-weight);
  color: var(--vscode-foreground);
  background-color: var(--vscode-sideBar-background);
  padding: 16px;
  margin: 0;
}

.task-section {
  margin-bottom: 20px;
}

.task-item {
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.task-item:hover {
  background: var(--vscode-list-hoverBackground);
  border-color: var(--vscode-focusBorder);
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.task-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.task-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.task-date {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.view-report-hint {
  font-size: 11px;
  color: var(--vscode-textLink-foreground);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.task-item:hover .view-report-hint {
  opacity: 1;
}

.task-stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.stat-badges {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.stat-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 20px;
  border-radius: 4px;
  font-size: 12px;
  color: white;
}

.stat-critical {
  background: rgb(149, 29, 29);
}

.stat-high {
  background: #f56c6c;
}

.stat-medium {
  background: #e6a23c;
}

.stat-low {
  background: #67c23a
}

.stat-badge:hover {
  transform: scale(1.05);
  transition: transform 0.2s ease;
}

.task-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
}

.status-success {
  background: var(--vscode-charts-green);
  color: var(--vscode-editor-background);
}

.status-progress {
  background: var(--vscode-charts-blue);
  color: var(--vscode-editor-background);
}

.status-error {
  background: var(--vscode-charts-red);
  color: var(--vscode-editor-background);
}

.status-created {
  background: var(--vscode-charts-orange);
  color: var(--vscode-editor-background);
}

.status-default {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

.no-data {
  color: var(--vscode-descriptionForeground);
  font-style: italic;
  text-align: center;
  padding: 20px;
}

.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 60px;
  color: var(--vscode-descriptionForeground);
}

/* Authentication Status Styles */
.auth-required {
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 16px;
  text-align: center;
}

.auth-message {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 14px;
  color: var(--vscode-charts-yellow);
}

.auth-icon {
  font-size: 16px;
}
</style>

<style>
body {
  overflow: hidden;
  padding: 0;
}

#app {
  height: 100vh;
  overflow: auto;
}
</style>
