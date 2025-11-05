<template>
<div class="app-container">
  <!-- Authentication Status -->
  <div v-if="!isAuthenticated" class="auth-required">
    <div class="auth-message">
      <span class="auth-icon">🔐</span>
      <span>Please log in to view SBOM analysis</span>
    </div>
  </div>

  <!-- Analysis Status -->
  <div v-else-if="isAnalyzing && scaReport.length === 0" class="analysis-status">
    <div class="analysis-message">
      <span class="analysis-icon">🔍</span>
      <span>Analyzing dependencies... This may take a few moments.</span>
    </div>
  </div>

  <!-- Analysis Failed -->
  <div v-else-if="analysisFailed" class="analysis-failed">
    <div class="failed-message">
      <span class="failed-icon">❌</span>
      <span>Analysis failed: {{ errorMessage }}</span>
      <button @click="retryAnalysis" class="retry-button">Retry</button>
    </div>
  </div>

  <!-- Analysis Results -->
  <div v-else>
    <div class="no-data" v-if="scaReport.length === 0 && !isAnalyzing">
      <div class="no-data-message">
        <span class="no-data-icon">📦</span>
        <span>No dependency files found</span>
        <div class="no-data-hint">Make sure your project has pom.xml files</div>
        <button @click="triggerAnalysis" class="retry-button">Scan Dependencies</button>
      </div>
    </div>

    <div class="project-task-list" v-if="scaReport.length > 0">
      <div v-for="task in scaReport" :key="task.fileHash" class="project-task-item"
        @click="openReportDetail(task.fileHash)">
        <div class="task-header">
          <div class="task-name">{{ task.depFile }}</div>
          <div class="task-actions">
            <div class="view-report-hint">Click to view report →</div>
          </div>
        </div>
        <div class="task-stats">
          <div class="stat-badges">
            <div class="stat-badge stat-critical" :title="`Critical: ${task.issueStats.critical}`">
              {{ task.issueStats.critical }}
            </div>
            <div class="stat-badge stat-high" :title="`High: ${task.issueStats.high}`">
              {{ task.issueStats.high }}
            </div>
            <div class="stat-badge stat-medium" :title="`Medium: ${task.issueStats.medium}`">
              {{ task.issueStats.medium }}
            </div>
            <div class="stat-badge stat-low" :title="`Low: ${task.issueStats.low}`">
              {{ task.issueStats.low }}
            </div>
          </div>
          <div class="task-status" v-if="task.status">
            <div :class="`status-badge ${getStatusClass(task.status)}`">
              {{ task.status }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Ref } from 'vue';
import { vscodeApi } from '../../utils/vscode';
import { provideVSCodeDesignSystem, vsCodeButton } from "@vscode/webview-ui-toolkit";

provideVSCodeDesignSystem().register(vsCodeButton());

type ScaReport = {
  depFile: string;
  fileHash: string;
  issueStats: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    unknown: number;
  };
  totalIssues: number;
  status: 'created' | 'running' | 'success' | 'failed';
}

const scaReport: Ref<ScaReport[]> = ref([]);
const isAuthenticated = ref(false);
const isAnalyzing = ref(false);
const analysisFailed = ref(false);
const errorMessage = ref('');

const openReportDetail = (fileHash: string) => {
  vscodeApi.post('openSbomReportDetail', {
    fileHash: fileHash,
  });
};

// 触发SBOM分析
const triggerAnalysis = () => {
  vscodeApi.post('triggerSbomAnalysis', {
    type: 'triggerSbomAnalysis'
  });
};

// 重试分析
const retryAnalysis = () => {
  analysisFailed.value = false;
  errorMessage.value = '';
  triggerAnalysis();
};

const getStatusClass = (status: string) => {
  switch (status) {
    case 'running':
      return 'status-running';
    case 'success':
      return 'status-success';
    case 'failed':
      return 'status-failed';
    default:
      return '';
  }
};

// 监听来自extension的消息
vscodeApi.on('authStatusChanged', (data: { isAuthenticated: boolean }) => {
  console.log('SBOM View: Received authStatusChanged:', data);
  isAuthenticated.value = data.isAuthenticated;

  if (!isAuthenticated.value) {
    isAnalyzing.value = false;
    analysisFailed.value = false;
    errorMessage.value = '';
    scaReport.value = [];
  }
});

vscodeApi.on('sbomAnalysisInitialized', (data: { reports: ScaReport[], isAnalyzing: boolean }) => {
  console.log('SBOM View: Analysis initialized:', data);
  isAnalyzing.value = data.isAnalyzing;
  analysisFailed.value = false;
  errorMessage.value = '';
  scaReport.value = data.reports || [];
});

vscodeApi.on('sbomAnalysisReportUpdated', (data: { report: Partial<ScaReport> }) => {
  console.log('SBOM View: Report updated:', data);
  const index = scaReport.value.findIndex(r => r.depFile === data.report.depFile);
  if (index !== -1) {
    scaReport.value[index] = { ...scaReport.value[index], ...data.report };
  }
});

vscodeApi.on('sbomAnalysisCompleted', () => {
  console.log('SBOM View: Analysis completed');
  isAnalyzing.value = false;
});

vscodeApi.on('sbomAnalysisFailed', (data: { error: string }) => {
  console.log('SBOM View: Analysis failed:', data);
  isAnalyzing.value = false;
  analysisFailed.value = true;
  errorMessage.value = data.error;
});

// 组件挂载时检查认证状态
onMounted(() => {
  // 请求当前认证状态
  vscodeApi.post('checkAuthStatus', {
    type: 'checkAuthStatus'
  });
});
</script>

<style scoped>
.app-container {
  box-sizing: border-box;
  padding: 10px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  /* 隐藏滚动条但保持滚动功能 */
  overflow: auto;
  height: 100vh;
}

.app-container::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

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

.analysis-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px;
  color: var(--vscode-foreground);
}

.analysis-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}

.analysis-icon {
  font-size: 24px;
}

.analysis-failed {
  background: rgba(231, 76, 60, 0.1);
  border: 1px solid rgba(231, 76, 60, 0.3);
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 16px;
  text-align: center;
}

.failed-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--vscode-errorForeground);
}

.failed-icon {
  font-size: 16px;
}

.retry-button {
  margin-top: 10px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  border-radius: 2px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}

.retry-button:hover {
  background: var(--vscode-button-hoverBackground);
}

.no-data {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px;
  color: var(--vscode-foreground);
}

.no-data-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}

.no-data-icon {
  font-size: 24px;
}

.no-data-hint {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  margin-top: 4px;
}

.project-task-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.project-task-item {
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

.project-task-item:hover {
  background: var(--vscode-list-hoverBackground);
  border-color: var(--vscode-focusBorder);
}

.task-header {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

.task-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  color: var(--vscode-foreground);
  font-size: 14px;
}

.task-actions {
  top: 100%;
  left: 0;
  position: absolute;
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.view-report-hint {
  font-size: 11px;
  color: var(--vscode-textLink-foreground);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.project-task-item:hover .view-report-hint {
  opacity: 1;
}

.task-stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-badges {
  display: flex;
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
  background: #67c23a;
}

.task-status {
  display: flex;
  align-items: center;
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

.status-running {
  background: #f0ad4e;
  color: var(--vscode-editor-background);
}

.status-failed {
  background: var(--vscode-errorForeground);
  color: var(--vscode-editor-background);
}

.status-running .task-name {
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% {
    opacity: 1;
  }

  50% {
    opacity: 0.6;
  }

  100% {
    opacity: 1;
  }
}

/* Webkit浏览器 (Chrome, Safari) - 隐藏滚动条 */
.app-container::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.header {
  margin-bottom: 5px;
}

.title {
  font-weight: bold;
  color: var(--vscode-editor-foreground);
}

.issues-summary {
  margin-bottom: 10px;
  color: var(--vscode-text-separator-foreground);
}

vscode-data-grid {
  width: 100%;
}

vscode-data-grid-cell {
  display: flex;
  align-items: center;
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