<template>
<div class="reports-container">
  <div class="reports-header">
    <h3>Security Reports</h3>
    <div class="reports-stats" v-if="issues.length > 0">
      <span class="total-count">{{ issues.length }} reports</span>
    </div>
  </div>

  <div v-if="loading" class="loading">
    <div class="loading-spinner"></div>
    Loading issues...
  </div>

  <div v-else-if="error" class="error">
    <span class="error-icon">⚠</span>
    {{ error }}
  </div>

  <div v-else-if="issues.length === 0" class="no-issues">
    <span class="no-issues-icon">✓</span>
    No security issues found
  </div>

  <div v-else class="issues-list">
    <div v-for="issue in issues" :key="`${currentTaskId}-${issue.vulId}`" class="issue-item" :class="{
      'expanded': expandedIssues.has(issue.vulId),
      'not-purchased': issue.purchaseStatus !== 'PURCHASED'
    }" @click="issue.purchaseStatus === 'PURCHASED' ? toggleIssue(issue.vulId) : null">
      <div class="issue-header">
        <div class="issue-icon">
          <span class="severity-icon" :class="getSeverityClass(issue.severity)">
            {{ getSeverityIcon(issue.severity) }}
          </span>
        </div>
        <div class="issue-content">
          <div class="issue-title">{{ issue.category }}</div>
          <div class="issue-meta">
            <span class="issue-vulid">VulID: {{ issue.vulId.slice(0, 8) }}</span>
            <span class="issue-cwe">CWE: {{ issue.cweId }}</span>
          </div>
          <!-- 显示购买状态 -->
          <div v-if="issue.purchaseStatus !== 'PURCHASED'" class="purchase-status">
            <span class="purchase-badge">
              <span class="purchase-icon">🔒</span>
              Subscribe to view details
            </span>
          </div>
        </div>
        <div class="issue-severity">
          <span class="severity-badge" :class="getSeverityClass(issue.severity)">
            {{ issue.severity }}
          </span>
        </div>
        <div class="expand-icon" v-if="issue.purchaseStatus === 'PURCHASED'">
          <span :class="{ 'expanded': expandedIssues.has(issue.vulId) }">
            {{ expandedIssues.has(issue.vulId) ? '▼' : '▶' }}
          </span>
        </div>
        <div class="lock-icon" v-else>
          <span class="locked">🔒</span>
        </div>
      </div>

      <div v-if="expandedIssues.has(issue.vulId) && issue.purchaseStatus === 'PURCHASED'" class="issue-details">
        <div v-if="loadingDetails.has(issue.vulId)" class="loading-details">
          Loading details...
        </div>
        <div v-else-if="issueDetails[issue.vulId]" class="details-content">
          <div class="details-section" v-if="issueDetails[issue.vulId].apiPath">
            <h4>API Information</h4>
            <div class="api-info">
              <span class="api-method">{{ issueDetails[issue.vulId].apiMethod }}</span>
              <span class="api-path">{{ issueDetails[issue.vulId].apiPath }}</span>
            </div>
          </div>

          <!-- 使用新的漏洞展示组件 -->
          <div class="details-section">
            <VulnerabilityDisplay :issue-detail="issueDetails[issue.vulId]" :show-data-flow="showDataFlow" />
          </div>

          <!-- <div class="details-section" v-if="issueDetails[issue.vulId].pocScript">
              <h4>POC Actions</h4>
              <div class="poc-actions">
                <button 
                  class="execute-button" 
                  @click.stop="executePocScript(issue.vulId, issueDetails[issue.vulId].pocScript)"
                  :disabled="executingPoc.has(issue.vulId)"
                >
                  {{ executingPoc.has(issue.vulId) ? 'Executing...' : 'Execute POC' }}
                </button>
              </div>
              <div v-if="pocExecutionResults[issue.vulId]" class="poc-result">
                <div class="result-status" :class="{ 'success': pocExecutionResults[issue.vulId].success, 'error': !pocExecutionResults[issue.vulId].success }">
                  {{ pocExecutionResults[issue.vulId].success ? '✓' : '✗' }}
                </div>
                <div class="result-message">
                  {{ pocExecutionResults[issue.vulId].message }}
                </div>
                <div v-if="!pocExecutionResults[issue.vulId].hasCodeRunner" class="code-runner-warning">
                  <span class="warning-icon">⚠</span>
                  Code Runner extension is required to execute POC scripts.
                </div>
              </div>
            </div> -->
        </div>
      </div>
    </div>
  </div>
</div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import { vscodeApi } from '../../utils/index';
import VulnerabilityDisplay from './components/index.vue';

interface Issue {
  ovId: number;
  vulId: string;
  category: string;
  description: string;
  cweId: string;
  taskId: string;
  purchaseStatus: string;
  price: number;
  severity: string;
}

interface IssueDetail {
  ovId: number;
  vulId: string;
  taskId: string;
  taskLang: string;
  category: string;
  description: string;
  cweId: string;
  severity: string;
  source: {
    file: string;
    method: string;
    message: string;
    location: {
      file_uri: string;
      end_column: number;
      start_line: number;
      start_column: number;
    };
    code_snippet: string;
  };
  sink: {
    file: string;
    method: string;
    message: string;
    location: {
      file_uri: string;
      end_column: number;
      start_line: number;
      start_column: number;
    };
    code_snippet: string;
  };
  apiPath: string;
  apiMethod: string;
  location: string;
  verifyResult: string;
  pocScript: string;
  pocScriptOutput: string;
  purchaseStatus: string;
  componentTask: boolean;
  fix_suggestion?: string;
}

interface TaskDetail {
  taskId: string;
  lang: string;
  projectName: string;
  sourceCode?: string;
  taskStatus: 'CREATED' | 'RUNNING' | 'FINISHED' | 'FAILED' | 'SUCCESS';
  errorCode?: number;
  errorDetail?: string;
  params?: {
    originRequestData: {
      javaPackage: string | null;
      sourceCodeInfos: any[];
      sandboxAuthInfos: {
        loginUrl: string;
        roleName: string;
        originRequestData: {
          cookies: {
            name: string;
            path: string;
            size: number;
            value: string;
            domain: string;
            secure: boolean;
            expires: number;
            session: boolean;
            httpOnly: boolean;
            priority: string;
            sameParty: boolean;
            sourceScheme: string;
          }[];
          headers: {
            url: string;
            method: string;
            requestHeaders: {
              name: string;
              value: string;
            }[];
          }[];
          roleName: string;
          localStorage: Record<string, any>;
          sessionStorage: Record<string, any>;
        };
      }[];
      primarySourceCode: string;
      sandboxHomePageUrl: string;
      sandboxTargetServiceUrl: string;
      primarySourceCodeFileName: string;
    };
    poc: {
      sandboxUrl: string;
      useLocalPython: boolean;
      sandboxAuthHeaders: string;
    };
    pf: {
      buildTargetFile: string | null;
    };
  };
  stages?: {
    preprocess: {
      info: string;
      duration: string;
      createCodeqlDbStatus: string;
    };
  };
  createdAt: string;
  updatedAt: string;
  executedAt?: string;
  createdBy?: string;
  tokenUsed: number;
  enableStaticVerification: boolean;
}

// Reactive state
const loading = ref(false);
const error = ref('');
const issues = ref<Issue[]>([]);
const expandedIssues = ref(new Set<string>());
const loadingDetails = ref(new Set<string>());
const issueDetails = reactive<Record<string, IssueDetail>>({});
const currentTaskId = ref<string | null>(null);
const executingPoc = ref(new Set<string>());
const pocExecutionResults = reactive<Record<string, { success: boolean; message: string; hasCodeRunner: boolean }>>({});
const taskDetail = ref<TaskDetail | null>(null);

const showDataFlow = computed(() => {
  const sourceCodeInfos = taskDetail.value?.params?.originRequestData?.sourceCodeInfos;

  if (!sourceCodeInfos || sourceCodeInfos.length === 0) {
    return false;
  }

  return true;
});

// Get severity CSS class
const getSeverityClass = (severity: string): string => {
  switch (severity.toLowerCase()) {
    case 'critical':
      return 'severity-critical';
    case 'high':
      return 'severity-high';
    case 'medium':
      return 'severity-medium';
    case 'low':
      return 'severity-low';
    default:
      return 'severity-unknown';
  }
};

// Get severity icon
const getSeverityIcon = (severity: string): string => {
  switch (severity.toLowerCase()) {
    case 'critical':
      return '⚠';
    case 'high':
      return '⚠';
    case 'medium':
      return '⚠';
    case 'low':
      return '⚠';
    default:
      return '?';
  }
};

// Toggle issue expansion
const toggleIssue = async (vulId: string) => {
  // 检查购买状态
  const issue = issues.value.find(i => i.vulId === vulId);
  if (!issue || issue.purchaseStatus !== 'PURCHASED') {
    return;
  }

  if (expandedIssues.value.has(vulId)) {
    expandedIssues.value.delete(vulId);
  } else {
    expandedIssues.value.add(vulId);

    // Load issue details if not already loaded
    if (!issueDetails[vulId] && currentTaskId.value) {
      loadingDetails.value.add(vulId);
      try {
        vscodeApi.post('fetchIssueDetail', {
          type: 'fetchIssueDetail',
          data: {
            taskId: currentTaskId.value,
            vulId: vulId
          }
        });
      } catch (error) {
        console.error('Error fetching issue detail:', error);
        loadingDetails.value.delete(vulId);
      }
    }
  }
};

// Execute POC script
// const executePocScript = (vulId: string, pocScript: string) => {
//   if (!pocScript || !pocScript.trim()) {
//     pocExecutionResults[vulId] = {
//       success: false,
//       message: 'POC script is empty',
//       hasCodeRunner: false
//     };
//     return;
//   }

//   executingPoc.value.add(vulId);

//   vscodeApi.post('executePocScript', {
//     type: 'executePocScript',
//     data: {
//       vulId: vulId,
//       pocScript: pocScript
//     }
//   });
// };

// Listen for messages from extension
vscodeApi.on('updateIssues', (data: { issues: Issue[]; total: number; taskId: string; error?: string }) => {
  console.log('Received updateIssues:', data);

  if (data.error) {
    error.value = data.error;
    loading.value = false;
    return;
  }

  issues.value = data.issues || [];
  currentTaskId.value = data.taskId;
  loading.value = false;
  error.value = '';
});

vscodeApi.on('updateIssueDetail', (data: { vulId: string; detail?: IssueDetail; error?: string }) => {
  console.log('Received updateIssueDetail:', data);

  loadingDetails.value.delete(data.vulId);

  if (data.error) {
    console.error('Error loading issue detail:', data.error);
    return;
  }

  if (data.detail) {
    issueDetails[data.vulId] = data.detail;
  }
});

vscodeApi.on('pocExecutionResult', (data: { vulId: string; success: boolean; message: string; hasCodeRunner: boolean }) => {
  console.log('Received pocExecutionResult:', data);

  executingPoc.value.delete(data.vulId);

  pocExecutionResults[data.vulId] = {
    success: data.success,
    message: data.message,
    hasCodeRunner: data.hasCodeRunner
  };
});

vscodeApi.on('initTaskDetail', (data: { taskId: string; detail?: TaskDetail; error?: string }) => {
  console.log('Received initTaskDetail:', data);

  if (data.error) {
    console.error('Error loading task detail:', data.error);
    return;
  }

  if (data.detail) {
    taskDetail.value = data.detail;
  }
});
</script>

<style scoped>
.reports-container {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background-color: var(--vscode-editor-background);
  padding: 16px;
  height: 100vh;
  overflow-y: auto;
}

.reports-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.reports-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.reports-stats {
  display: flex;
  align-items: center;
  gap: 12px;
}

.total-count {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.refresh-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}

.refresh-btn:hover {
  background: var(--vscode-button-hoverBackground);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-icon {
  font-size: 14px;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
  color: var(--vscode-descriptionForeground);
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--vscode-descriptionForeground);
  border-top: 2px solid transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

.error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background: var(--vscode-inputValidation-errorBackground);
  color: var(--vscode-inputValidation-errorForeground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  border-radius: 4px;
}

.error-icon {
  font-size: 16px;
}

.no-issues {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
  color: var(--vscode-descriptionForeground);
}

.no-issues-icon {
  font-size: 24px;
  color: var(--vscode-testing-iconPassed);
}

.issues-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.issue-item {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  background: var(--vscode-editor-background);
  cursor: pointer;
  transition: all 0.2s ease;
}

.issue-item:hover {
  background: var(--vscode-list-hoverBackground);
}

.issue-item.expanded {
  background: var(--vscode-list-focusHighlightForeground);
}

.issue-item.not-purchased {
  opacity: 0.7;
  cursor: not-allowed;
  background: var(--vscode-input-background);
  border: 1px dashed var(--vscode-panel-border);
}

.issue-item.not-purchased:hover {
  background: var(--vscode-input-background);
  opacity: 0.8;
}

.issue-header {
  display: flex;
  align-items: center;
  padding: 12px;
  gap: 12px;
}

.issue-icon {
  flex-shrink: 0;
}

.severity-icon {
  font-size: 16px;
  font-weight: bold;
}

.severity-critical {
  color: #ff4444;
}

.severity-high {
  color: #ff6600;
}

.severity-medium {
  color: #ffaa00;
}

.severity-low {
  color: #00aa00;
}

.severity-unknown {
  color: var(--vscode-descriptionForeground);
}

.issue-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.issue-title {
  font-weight: 600;
  font-size: 14px;
}

.issue-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.issue-vulid,
.issue-cwe {
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.purchase-status {
  margin-top: 4px;
}

.purchase-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: var(--vscode-inputValidation-warningBackground);
  border: 1px solid var(--vscode-inputValidation-warningBorder);
  border-radius: 4px;
  color: var(--vscode-inputValidation-warningForeground);
  font-size: 10px;
  font-weight: 500;
}

.purchase-icon {
  font-size: 10px;
}

.lock-icon {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.locked {
  opacity: 0.5;
}

.issue-severity {
  flex-shrink: 0;
}

.severity-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: white;
}

.severity-badge.severity-critical {
  background: #ff4444;
}

.severity-badge.severity-high {
  background: #ff6600;
}

.severity-badge.severity-medium {
  background: #ffaa00;
}

.severity-badge.severity-low {
  background: #00aa00;
}

.expand-icon {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  transition: transform 0.2s ease;
}

.expand-icon .expanded {
  transform: rotate(90deg);
}

.issue-details {
  padding: 0 12px 12px 12px;
  border-top: 1px solid var(--vscode-panel-border);
  background: var(--vscode-input-background);
}

.loading-details {
  padding: 12px;
  text-align: center;
  color: var(--vscode-descriptionForeground);
}

.details-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px 0;
}

.details-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.details-section h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-foreground);
}



.cwe-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cwe-id {
  font-size: 12px;
  color: var(--vscode-textLink-foreground);
  text-decoration: underline;
}

.api-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.api-method {
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-foreground);
  background: var(--vscode-badge-background);
  padding: 2px 6px;
  border-radius: 4px;
}

.api-path {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family);
}

.poc-script {
  background: var(--vscode-textCodeBlock-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 8px;
  overflow-x: auto;
}

.poc-script pre {
  margin: 0;
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  line-height: 1.4;
  color: var(--vscode-editor-foreground);
  white-space: pre-wrap;
  word-wrap: break-word;
}

.poc-actions {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.execute-button {
  background-color: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background-color 0.2s;
}

.execute-button:hover:not(:disabled) {
  background-color: var(--vscode-button-hoverBackground);
}

.execute-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.poc-result {
  margin-top: 8px;
  padding: 8px;
  border-radius: 4px;
  background-color: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.result-status {
  font-weight: bold;
  min-width: 16px;
}

.result-status.success {
  color: var(--vscode-testing-iconPassed);
}

.result-status.error {
  color: var(--vscode-testing-iconFailed);
}

.result-message {
  flex: 1;
  font-size: 12px;
  line-height: 1.4;
}

.code-runner-warning {
  width: 100%;
  margin-top: 4px;
  padding: 4px 8px;
  background-color: var(--vscode-inputValidation-warningBackground);
  border: 1px solid var(--vscode-inputValidation-warningBorder);
  border-radius: 4px;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.warning-icon {
  color: var(--vscode-inputValidation-warningForeground);
  font-weight: bold;
}
</style>
