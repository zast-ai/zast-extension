<template>
  <div class="app-container">
    <div class="assess-title">
      <h1 class="assess-title-text">Security Assessment</h1>
      <p class="assess-description">
        Configure your security assessment parameters and start vulnerability analysis.
      </p>
    </div>
    <!-- Only show these components when assessment is not successful -->
    <div v-if="!assessSuccess">
      <Artifact :artifactList="artifactList" :refresh="refreshArtifacts" :onchange="handleArtifactChange" />
      <ServiceUrl :serviceUrl="serviceUrl" :servicePath="servicePath" :activePort="activePort"
        @createTunnel="handleCreateTunnel" @stopTunnel="handleStopTunnel" @testTunnel="handleTestTunnel"
        @pathChange="handlePathChange" @retryDiagnostics="handleRetryDiagnostics" :error="tunnelError"
        :diagnosticsStatus="diagnosticsStatus" :diagnosticsStages="diagnosticsStages"
        :diagnosticsRetryCountdown="diagnosticsRetryCountdown"
        :diagnosticsManualRetryThreshold="DIAGNOSTICS_MANUAL_RETRY_THRESHOLD" />
      <Session :serviceUrl="serviceUrl" :browserUrl="browserUrl" :diagnosticsSuccess="diagnosticsStatus === 'success'"
        @requestBrowserUrl="handleRequestBrowserUrl" @accountsChange="handleAccountsChange" />

      <!-- Assess Section -->
      <div class="assess-section">
        <!-- Assessment Status Header -->
        <div class="assessment-header">
          <div class="assessment-status">
            <div class="status-text">
              <span class="status-title">Assessment Status</span>
              <span class="status-badge" :class="{ 'complete': canAssess }">
                {{ completedRequirements }}/{{ totalRequirements }} Requirements Met
              </span>
            </div>
          </div>
        </div>

        <!-- Warning Message -->
        <div v-if="!canAssess && !assessLoading" class="warning-message">
          <svg class="icon warning-icon" aria-hidden="true">
            <use xlink:href="#icon-info"></use>
          </svg>
          <div class="warning-text">
            Security assessment is currently unavailable. Please complete all requirements below to proceed.
          </div>
        </div>

        <!-- Loading Status -->
        <div v-if="assessLoading" class="loading-message">
          <div class="loading-spinner"></div>
          <div class="loading-text">
            Assessment in progress, please wait...
          </div>
        </div>

        <!-- Requirements Checklist -->
        <div class="requirements-section">
          <h3 class="requirements-title">Requirements Checklist:</h3>
          <div class="requirements-list">
            <div class="requirement-item" :class="{ 'completed': selectedArtifact }">
              <div class="requirement-status">
                <div class="status-indicator" :class="{ 'complete': selectedArtifact }">
                  {{ selectedArtifact ? '✓' : '' }}
                </div>
              </div>
              <div class="requirement-content">
                <span class="requirement-text">Select an artifact</span>
                <span class="requirement-badge" v-if="selectedArtifact">Complete</span>
              </div>
            </div>

            <div class="requirement-item" :class="{ 'completed': serviceUrl }">
              <div class="requirement-status">
                <div class="status-indicator" :class="{ 'complete': serviceUrl }">
                  {{ serviceUrl ? '✓' : '' }}
                </div>
              </div>
              <div class="requirement-content">
                <span class="requirement-text">Service URL configured</span>
                <span class="requirement-badge" v-if="serviceUrl">Complete</span>
              </div>
            </div>

            <div class="requirement-item"
              :class="{ 'completed': sessionAccounts.filter(account => account.originRequestData).length > 0 }">
              <div class="requirement-status">
                <div class="status-indicator"
                  :class="{ 'complete': sessionAccounts.filter(account => account.originRequestData).length > 0 }">
                  {{sessionAccounts.filter(account => account.originRequestData).length > 0 ? '✓' : ''}}
                </div>
              </div>
              <div class="requirement-content">
                <span class="requirement-text">Session accounts with valid data configured</span>
                <span class="requirement-badge"
                  v-if="sessionAccounts.filter(account => account.originRequestData).length > 0">Complete</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="action-buttons">
          <vscode-button appearance="primary" @click="handleAssess" :disabled="!canAssess || assessLoading"
            class="assess-button">
            <div v-if="assessLoading" class="loading-content">
              <span class="loading-spinner"></span>
              Assessing...
            </div>
            <div v-else>
              Start Security Assessment
            </div>
          </vscode-button>
        </div>
      </div>
    </div>

    <!-- Success page - only shown when assessment is successful -->
    <div v-if="assessSuccess && !assessLoading" class="success-page">
      <div class="success-content">
        <div class="success-icon">
          ✅
        </div>
        <div class="success-title">
          Task Created Successfully!
        </div>
        <div class="success-message">
          Your security assessment task has been created and is now running.
        </div>
        <div class="success-notice">
          <div class="notice-title">
            <strong>Important Notice:</strong>
          </div>
          <div class="notice-content">
            • This page can now be closed safely<br>
            • Please keep the tunnel service running<br>
            • Do not stop the tunnel service port during assessment
          </div>
        </div>
        <vscode-button appearance="primary" @click="handleClosePage" class="close-button">
          Close This Page
        </vscode-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { allComponents, provideVSCodeDesignSystem } from '@vscode/webview-ui-toolkit';
import Session from './components/session.vue';
import Artifact, { type ArtifactItem } from './components/artifact.vue';
import ServiceUrl from './components/service-url.vue';
import { ref, computed, onBeforeMount } from 'vue';
import { vscodeApi } from '../../utils/index';
import "@tomjs/vite-plugin-vscode/client"
import '../../fonts/iconfont.js'


// Import Account type from session component
interface Account {
  roleName: string;
  loginUrl: string;
  originRequestData: any;
}

type SelectedArtifact = Omit<ArtifactItem, 'sourceCodePaths' | 'type'> & {
  sourceCodePaths?: string[];
  language: 'java' | 'javascript' | 'python';
}

provideVSCodeDesignSystem().register(allComponents);

const selectedArtifact = ref<SelectedArtifact | null>(null);
const serviceUrl = ref('');
const servicePath = ref('');
const assessLoading = ref(false);
const assessSuccess = ref(false);
const tunnelError = ref('');

// Network diagnostics configuration
const DIAGNOSTICS_AUTO_RETRY_SECONDS = 30; // Total auto retry time
const DIAGNOSTICS_MANUAL_RETRY_THRESHOLD = 15; // Allow manual retry after this many seconds

// Network diagnostics state
const diagnosticsStatus = ref<'idle' | 'running' | 'success' | 'failed'>('idle');
const diagnosticsStages = ref<any[]>([]);
const diagnosticsRetryTimer = ref<NodeJS.Timeout | null>(null);
const diagnosticsRetryCountdown = ref(0);
const diagnosticsCountdownTimer = ref<NodeJS.Timeout | null>(null);

// const browserServiceUrl = ref('http://34.219.9.118:8080/ofcms-admin/');
// const browserUrl = ref('http://localhost:9091/zast/123/login?token=zast'); // Set to empty string to test the unavailable state
const browserUrl = ref('');

// Artifact list state
const artifactList = ref<ArtifactItem[]>([]);

// Session accounts state
const sessionAccounts = ref<Account[]>([]);

// Active port from debug session
const activePort = ref<number | null>(null);

// Refresh callback function
const refreshArtifacts = async () => {
  console.log('Refreshing artifacts from parent...');
  // TODO: Implement actual refresh logic, e.g. call VSCode API
  // This could involve sending a message to the extension to discover artifacts
  // For now, we'll just simulate adding a new artifact
  vscodeApi.postMessage({
    type: 'artifacts',
  });
};

// Onchange callback function
const handleArtifactChange = (artifact: ArtifactItem | null, uploadSourceCode: boolean, additionalFiles?: { path: string, type: 'file' | 'folder' }[], language?: string) => {
  console.log('Selected artifact changed:', artifact);
  console.log('Upload source code:', uploadSourceCode);
  console.log('Additional files:', additionalFiles);
  console.log('Language:', language);

  if (artifact) {
    // Create a new artifact object based on uploadSourceCode flag
    let sourceCodePaths = uploadSourceCode ? artifact.sourceCodePaths : [];

    selectedArtifact.value = {
      name: artifact.name,
      path: artifact.path,
      size: artifact.size,
      sourceCodePaths: sourceCodePaths,
      language: artifact.language
    };

  } else if (additionalFiles && additionalFiles.length > 0) {
    selectedArtifact.value = {
      path: additionalFiles[0].path,
      name: '',
      size: 0,
      language: language as 'java' | 'javascript' | 'python' || 'java'
    }
  } else {
    selectedArtifact.value = null;
  }
};

// Service URL event handlers
const handleCreateTunnel = (port: string) => {
  console.log('Creating tunnel for port:', port);
  tunnelError.value = '';
  vscodeApi.postMessage({
    type: 'createTunnel',
    port: port
  });
};

const handleStopTunnel = (port: string) => {
  console.log('Stopping tunnel');
  serviceUrl.value = '';
  servicePath.value = ''; // Reset path when tunnel is stopped

  // Reset diagnostics state when tunnel is stopped
  diagnosticsStatus.value = 'idle';
  diagnosticsStages.value = [];
  clearDiagnosticsRetryTimer();
  clearDiagnosticsCountdownTimer();

  vscodeApi.postMessage({
    type: 'stopTunnel',
    port: port
  });
};

const handleTestTunnel = (url: string) => {
  console.log('Testing tunnel URL:', url);
  vscodeApi.postMessage({
    type: 'testTunnel',
    url: url
  });
};

const handleRequestBrowserUrl = () => {
  console.log('Requesting browser URL...');
  vscodeApi.postMessage({
    type: 'requestBrowserUrl'
  });
};

const handleAccountsChange = (accounts: Account[]) => {
  console.log('Session accounts changed:', accounts);
  sessionAccounts.value = accounts;
};

const handlePathChange = (path: string) => {
  console.log('Service path changed:', path);
  servicePath.value = path;
};

const handleRetryDiagnostics = () => {
  console.log('Retrying network diagnostics for URL:', serviceUrl.value);
  if (serviceUrl.value) {
    vscodeApi.postMessage({
      type: 'retryNetworkDiagnostics',
      url: serviceUrl.value
    });
  }
};

// Clear diagnostics retry timer
const clearDiagnosticsRetryTimer = () => {
  if (diagnosticsRetryTimer.value) {
    clearTimeout(diagnosticsRetryTimer.value);
    diagnosticsRetryTimer.value = null;
  }
};

// Clear diagnostics countdown timer
const clearDiagnosticsCountdownTimer = () => {
  if (diagnosticsCountdownTimer.value) {
    clearInterval(diagnosticsCountdownTimer.value);
    diagnosticsCountdownTimer.value = null;
  }
  diagnosticsRetryCountdown.value = 0;
};

// Start diagnostics retry timer with countdown
const startDiagnosticsRetryTimer = () => {
  clearDiagnosticsRetryTimer();
  clearDiagnosticsCountdownTimer();

  // Set initial countdown to configured auto retry seconds
  diagnosticsRetryCountdown.value = DIAGNOSTICS_AUTO_RETRY_SECONDS;

  // Start countdown timer (updates every second)
  diagnosticsCountdownTimer.value = setInterval(() => {
    diagnosticsRetryCountdown.value--;

    if (diagnosticsRetryCountdown.value <= 0) {
      clearDiagnosticsCountdownTimer();
      console.log(`Auto retrying network diagnostics after ${DIAGNOSTICS_AUTO_RETRY_SECONDS} seconds`);
      handleRetryDiagnostics();
    }
  }, 1000);

  // Set main retry timer as backup
  diagnosticsRetryTimer.value = setTimeout(() => {
    clearDiagnosticsCountdownTimer();
    console.log(`Auto retrying network diagnostics after ${DIAGNOSTICS_AUTO_RETRY_SECONDS} seconds`);
    handleRetryDiagnostics();
  }, DIAGNOSTICS_AUTO_RETRY_SECONDS * 1000);
};

// Utility function to join URL and path correctly
const joinUrl = (baseUrl: string, path: string): string => {
  if (!path || path.trim() === '') {
    return baseUrl;
  }

  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const cleanPath = path.startsWith('/') ? path : '/' + path;

  return cleanBaseUrl + cleanPath;
};

// Assess logic
const canAssess = computed(() => {
  return selectedArtifact.value && serviceUrl.value && sessionAccounts.value.filter(account => account.originRequestData).length > 0;
});

// Requirements tracking
const totalRequirements = ref(3);
const completedRequirements = computed(() => {
  let count = 0;
  if (selectedArtifact.value) count++;
  if (serviceUrl.value) count++;
  if (sessionAccounts.value.filter(account => account.originRequestData).length > 0) count++;
  return count;
});

const handleAssess = () => {
  console.log('Starting assessment...');
  if (canAssess.value) {
    // Correctly combine serviceUrl with servicePath using joinUrl utility
    const fullServiceUrl = joinUrl(serviceUrl.value, servicePath.value);

    const data = {
      projectName: selectedArtifact.value?.name,
      artifactPath: selectedArtifact.value?.path,
      sourceCodePaths: selectedArtifact.value?.sourceCodePaths || [],
      serviceUrl: fullServiceUrl,
      accounts: sessionAccounts.value,
      language: selectedArtifact.value?.language
    }
    vscodeApi.postMessage({
      type: 'startAssessment',
      data: JSON.stringify(data)
    });
    assessLoading.value = true;
    assessSuccess.value = false; // Reset success state
  } else {
    console.warn('Assessment requirements not met. Cannot start assessment.');
  }
};

const handleRefreshPort = () => {
  console.log('Refreshing port...');
  vscodeApi.postMessage({
    type: 'refreshPort'
  });
};

// Add close page handler
const handleClosePage = () => {
  console.log('Closing assessment page...');
  vscodeApi.postMessage({
    type: 'closePage'
  });
};

onBeforeMount(() => {
  refreshArtifacts();
  handleRefreshPort();
});

vscodeApi.on('browserUrl', (data: { browserUrl: string }) => {
  console.log('onDidChangeBrowserUrl', data);
  browserUrl.value = data.browserUrl;
});

vscodeApi.on('artifacts', (data: { artifactList: ArtifactItem[] }) => {
  console.log('onDidChangeArtifactList', data);
  artifactList.value = data.artifactList;
});

// Listen for tunnel events from extension
vscodeApi.on('tunnelCreated', (data: { url: string }) => {
  console.log('Tunnel created:', data.url);
  serviceUrl.value = data.url;
});

vscodeApi.on('tunnelStopped', (data: { port: number, reason?: string }) => {
  console.log('Tunnel stopped:', data.port, data.reason);
  serviceUrl.value = '';

  if (data.reason && data.reason !== 'manual-stop') {
    tunnelError.value = data.reason;
  }
});



// Listen for port updates from debug session
vscodeApi.on('portUpdate', (data: { port: number }) => {
  console.log('Port update received:', data.port);
  activePort.value = data.port;
});

// Listen for authentication logout events
vscodeApi.on('authenticationLogout', (data: { message: string }) => {
  console.log('Authentication logout event received:', data.message);

  // Reset assessment state when authentication is lost
  serviceUrl.value = '';
  servicePath.value = '';
  assessLoading.value = false;
  assessSuccess.value = false;

  // Could add a notification here if needed
  console.warn('Tunnels stopped due to authentication logout. Please log in again to continue.');
});

// Listen for tunnel creation failed events
vscodeApi.on('tunnelCreationFailed', (data: { port: number, reason: string }) => {
  console.log('Tunnel creation failed:', data);

  // Reset tunnel state - clear the service URL to trigger tunnel state reset
  serviceUrl.value = '';
  servicePath.value = '';
  tunnelError.value = data.reason;

  // Show appropriate message to user
  let message = 'Tunnel creation was cancelled.';
  if (data.reason === 'security-warning-cancelled') {
    message = 'Tunnel creation cancelled: Security warning not accepted.';
  } else if (data.reason === 'download-cancelled') {
    message = 'Tunnel creation cancelled: Cloudflared download was cancelled.';
  }

  console.warn(message);
});

// Listen for assessment events (both success and failure)
vscodeApi.on('assessment', (data: { success: boolean, taskId?: string, error?: string }) => {
  console.log('Assessment result:', data);
  assessLoading.value = false;
  assessSuccess.value = data.success;

  if (!data.success && data.error) {
    console.error('Assessment failed:', data.error);
  }
});

// Listen for network diagnostics events
vscodeApi.on('networkDiagnosticsStarted', (data: { url: string }) => {
  console.log('Network diagnostics started:', data.url);
  diagnosticsStatus.value = 'running';
  diagnosticsStages.value = [];
  clearDiagnosticsRetryTimer();
  clearDiagnosticsCountdownTimer();
});

vscodeApi.on('networkDiagnosticsUpdate', (data: { url: string, diagId: string, status: string, stageCount: number, nextStage: number, stages: any[] }) => {
  console.log('Network diagnostics update:', data);
  diagnosticsStages.value = data.stages;
});

vscodeApi.on('networkDiagnosticsCompleted', (data: { url: string, diagId: string, success: boolean, stages: any[] }) => {
  console.log('Network diagnostics completed:', data);
  diagnosticsStatus.value = data.success ? 'success' : 'failed';
  diagnosticsStages.value = data.stages;

  if (!data.success) {
    startDiagnosticsRetryTimer();
  } else {
    handleRequestBrowserUrl();
  }
});

vscodeApi.on('networkDiagnosticsFailed', (data: { url: string, error: string, canRetry: boolean }) => {
  console.error('Network diagnostics failed:', data);
  diagnosticsStatus.value = 'failed';

  if (data.canRetry) {
    startDiagnosticsRetryTimer();
  }
});
</script>

<style scoped>
.assess-title {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.assess-title-text {
  margin: 0;
}

.assess-description {
  margin: 0;
  font-size: 12px;
  color: var(--vscode-editorHint-foreground);
}

.icon {
  width: 1em;
  height: 1em;
  vertical-align: -0.15em;
  fill: currentColor;
  overflow: hidden;
}

.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 16px;
  gap: 16px;

  --input-height: 32;
}

.app-container>* {
  flex-shrink: 0;
}

.app-container>*:last-child {
  min-height: 0;
}

.assess-section {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 16px;
}

/* Assessment Header */
.assessment-header {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
}

.assessment-status {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-icon {
  font-size: 20px;
  width: 1em;
  height: 1em;
  color: var(--vscode-editorWarning-foreground);
}

.status-text {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.status-badge {
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  background-color: var(--vscode-editorWarning-background);
  color: var(--vscode-editorWarning-foreground);
  border: 1px solid var(--vscode-editorWarning-border);
}

.status-badge.complete {
  background-color: var(--vscode-editorInfo-background);
  color: var(--vscode-editorInfo-foreground);
  border: 1px solid var(--vscode-editorInfo-border);
}

/* Warning Message */
.warning-message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 16px;
  background-color: var(--vscode-editorWarning-background);
  border: 1px solid var(--vscode-editorWarning-border);
  border-radius: 6px;
  border: 1px solid var(--vscode-editorWarning-foreground);
}

.warning-icon {
  font-size: 20px;
}

.warning-text {
  font-size: 13px;
  color: var(--vscode-editorWarning-foreground);
  line-height: 1.4;
}

/* Loading Message */
.loading-message {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background-color: var(--vscode-editor-inactiveSelectionBackground);
  border-radius: 6px;
  border: 1px solid var(--vscode-panel-border);
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--vscode-panel-border);
  border-top: 2px solid var(--vscode-progressBar-background);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.loading-text {
  font-size: 13px;
  color: var(--vscode-foreground);
  font-weight: 500;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

/* Requirements Section */
.requirements-section {
  margin: 8px 0;
}

.requirements-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground);
  margin-bottom: 16px;
}

.requirements-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.requirement-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 6px;
  background-color: var(--vscode-editorInfo-background);
  border: 1px solid var(--vscode-panel-border);
}

.requirement-status {
  flex-shrink: 0;
}

.status-indicator {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--vscode-panel-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: bold;
}

.status-indicator.complete {
  background-color: var(--vscode-charts-green);
  border-color: var(--vscode-charts-green);
  color: white;
}

.requirement-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 1;
}

.requirement-text {
  font-size: 13px;
  color: var(--vscode-foreground);
}

.requirement-badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--vscode-charts-green);
  color: var(--vscode-charts-green);
}

/* Action Buttons */
.action-buttons {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.assess-button {
  flex: 1;
  min-height: 36px;
}

.save-button {
  min-height: 36px;
  padding: 0 16px;
}

.loading-content {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}

/* Success page styles */
.success-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 32px;
}

.success-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  max-width: 400px;
  width: 100%;
  text-align: center;
}

.success-icon {
  font-size: 48px;
  margin-bottom: 8px;
}

.success-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--vscode-charts-green);
  margin-bottom: 4px;
}

.success-message {
  font-size: 14px;
  color: var(--vscode-foreground);
  line-height: 1.5;
  margin-bottom: 8px;
}

.success-notice {
  width: 100%;
  padding: 16px;
  background-color: var(--vscode-editorWidget-background);
  border-radius: 6px;
  border-left: 4px solid var(--vscode-charts-orange);
  text-align: left;
}

.notice-title {
  font-size: 13px;
  color: var(--vscode-foreground);
  margin-bottom: 8px;
}

.notice-content {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.6;
}

.close-button {
  width: 100%;
  max-width: 200px;
  min-height: 36px;
  margin-top: 8px;
}

/* Remove the old assess-success styles since they're replaced by success-page */
.assess-success {
  width: 100%;
  max-width: 300px;
  text-align: center;
  padding: 16px;
  background-color: var(--vscode-editor-inactiveSelectionBackground);
  border-radius: 6px;
  border: 2px solid var(--vscode-charts-green);
  margin-top: 8px;
}
</style>
