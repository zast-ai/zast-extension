<template>
  <div class="service-url-container">
    <h3 class="service-url-title">
      API Base Url
      <span v-if="props.activePort" class="active-port-hint">
        (Port {{ props.activePort }} detected from debug session)
      </span>
    </h3>

    <p class="service-url-description">
      Enter the service port and tunnel to the service.
    </p>
    
    <div class="service-url-content">
      <div class="service-port-container">
        <vscode-text-field
          :value="servicePort"
          @input="handlePortChange"
          placeholder="Port"
          :readonly="tunnelActive"
          class="service-port-input"
        />
      </div>
      
      <div class="url-input-container">
        <vscode-text-field
          :value="currentServiceUrl"
          readonly
          placeholder="https://example.trycloudflare.com"
          class="url-input"
        />
      </div>
      
      <div class="path-input-container">
        <vscode-text-field
          :value="servicePath"
          @input="handlePathChange"
          placeholder="/path (optional)"
          :readonly="!props.serviceUrl || props.serviceUrl.trim() === ''"
          class="path-input"
        />
      </div>
      
      <div class="buttons-container">
        <vscode-button
          :appearance="tunnelActive ? 'secondary' : 'primary'"
          @click="handleTunnel"
          :disabled="!servicePort || servicePort.trim() === ''"
          class="tunnel-button"
        >
          {{ tunnelActive ? 'Stop' : 'Tunnel' }}
        </vscode-button>
      </div>
    </div>
    
    <!-- Error Message -->
    <div v-if="props.error" class="error-message">
      <svg class="icon error-icon" aria-hidden="true">
        <use xlink:href="#icon-warning"></use>
      </svg>
      <div class="error-text">
        {{ getErrorMessage(props.error) }}
      </div>
    </div>

    <!-- Network Diagnostics Section -->
    <div v-if="props.serviceUrl && props.serviceUrl.trim() !== ''" class="diagnostics-section">
      <h4 class="diagnostics-title">Network Diagnostics</h4>
      
      <!-- Diagnostics Status -->
      <div class="diagnostics-status">
        <div v-if="props.diagnosticsStatus === 'running'" class="status-item running">
          <div class="status-indicator">
            <div class="loading-spinner"></div>
          </div>
          <div class="status-text">
            <span class="status-label">Checking network connectivity...</span>
            <span class="status-description">Please wait while we verify the tunnel is accessible</span>
          </div>
        </div>
        
        <div v-else-if="props.diagnosticsStatus === 'success'" class="status-item success">
          <div class="status-indicator">
            <svg class="icon success-icon" aria-hidden="true">
              <use xlink:href="#icon-check"></use>
            </svg>
          </div>
          <div class="status-text">
            <span class="status-label">Network diagnostics passed</span>
            <span class="status-description">Your tunnel is accessible and ready for testing</span>
          </div>
        </div>
        
        <div v-else-if="props.diagnosticsStatus === 'failed'" class="status-item failed">
          <div class="status-indicator">
            <svg class="icon error-icon" aria-hidden="true">
              <use xlink:href="#icon-warning"></use>
            </svg>
          </div>
          <div class="status-text">
            <span class="status-label">Network diagnostics failed</span>
            <span class="status-description">There may be connectivity issues with your tunnel</span>
          </div>
          <div class="status-actions">
            <vscode-button
              appearance="secondary"
              @click="handleRetryDiagnostics"
              :disabled="props.diagnosticsRetryCountdown > props.diagnosticsManualRetryThreshold"
              class="retry-diagnostics-button"
            >
              {{ getRetryButtonText() }}
            </vscode-button>
          </div>
        </div>
      </div>

      <!-- Diagnostics Stages -->
      <div v-if="props.diagnosticsStages && props.diagnosticsStages.length > 0" class="diagnostics-stages">
        <div class="stages-title">Diagnostic Steps:</div>
        <div class="stages-list">
          <div 
            v-for="(stage, index) in props.diagnosticsStages" 
            :key="index"
            class="stage-item"
            :class="{ 'stage-pass': stage.status === 'PASS', 'stage-fail': stage.status === 'FAIL' }"
          >
            <div class="stage-status">
              <div v-if="stage.status === 'PASS'" class="stage-icon pass">✓</div>
              <div v-else-if="stage.status === 'FAIL'" class="stage-icon fail">✗</div>
              <div v-else class="stage-icon pending">-</div>
            </div>
            <div class="stage-content">
              <div class="stage-name">{{ stage.stageName }}</div>
              <div class="stage-description">{{ stage.description }}</div>
              <div v-if="stage.resultInfo" class="stage-result">{{ stage.resultInfo }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

// Props
interface Props {
  serviceUrl?: string;
  activePort?: number | null;
  servicePath?: string;
  error?: string;
  diagnosticsStatus?: 'idle' | 'running' | 'success' | 'failed';
  diagnosticsStages?: any[];
  diagnosticsRetryCountdown?: number;
  diagnosticsManualRetryThreshold?: number;
}

const props = withDefaults(defineProps<Props>(), {
  serviceUrl: '',
  activePort: null,
  servicePath: '',
  error: '',
  diagnosticsStatus: 'idle',
  diagnosticsStages: () => [],
  diagnosticsRetryCountdown: 0,
  diagnosticsManualRetryThreshold: 30
});

// Emits
const emit = defineEmits<{
  createTunnel: [port: string];
  stopTunnel: [port: string];
  testTunnel: [url: string];
  pathChange: [path: string];
  retryDiagnostics: [];
}>();

// Reactive state
const servicePort = ref('');
const servicePath = ref('');
const tunnelActive = ref(false);

// Watch for activePort changes and auto-fill the port input
watch(() => props.activePort, (newActivePort) => {
  if (newActivePort && !servicePort.value) {
    servicePort.value = newActivePort.toString();
  }
}, { immediate: true });

// Watch for servicePath prop changes
watch(() => props.servicePath, (newPath) => {
  servicePath.value = newPath || '';
}, { immediate: true });

// Watch for serviceUrl changes and update tunnel status
watch(() => props.serviceUrl, (newServiceUrl, oldServiceUrl) => {
  // If serviceUrl changes from non-empty to empty, set tunnelActive to false
  if (oldServiceUrl && oldServiceUrl.trim() !== '' && (!newServiceUrl || newServiceUrl.trim() === '')) {
    console.log('Service URL cleared, deactivating tunnel');
    tunnelActive.value = false;
  }
});

watch(() => props.error, (newError) => {
  if (newError) {
    console.error('Error:', newError);
    tunnelActive.value = false;
  }
}, { immediate: true });

// Computed
const currentServiceUrl = computed(() => {
  return props.serviceUrl;
});

// Methods
const handlePortChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  servicePort.value = target.value;
};

const handlePathChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  servicePath.value = target.value;
  emit('pathChange', target.value);
};

const handleTunnel = () => {
  if (tunnelActive.value) {
    // Stop tunnel
    console.log('Stopping tunnel');
    tunnelActive.value = false;
    emit('stopTunnel', servicePort.value);
  } else {
    // Create tunnel
    console.log('Creating tunnel for port:', servicePort.value);
    if (servicePort.value && servicePort.value.trim() !== '') {
      tunnelActive.value = true;
      emit('createTunnel', servicePort.value);
    }
  }
};

const handleRetryDiagnostics = () => {
  console.log('Retrying network diagnostics');
  emit('retryDiagnostics');
};

const getRetryButtonText = () => {
  if (props.diagnosticsRetryCountdown <= 0) {
    return 'Retry Check';
  } else if (props.diagnosticsRetryCountdown > props.diagnosticsManualRetryThreshold) {
    // Before manual retry threshold: show auto retry countdown
    return `Auto Retry (${props.diagnosticsRetryCountdown}s)`;
  } else {
    // After manual retry threshold: show manual retry option with countdown
    return `Retry Check (${props.diagnosticsRetryCountdown}s)`;
  }
};

const getErrorMessage = (errorReason: string): string => {
  switch (errorReason) {
    case 'security-warning-cancelled':
      return 'Tunnel creation cancelled: Security warning not accepted.';
    case 'download-cancelled':
      return 'Tunnel creation cancelled: Cloudflared download was cancelled.';
    default:
      return 'Tunnel creation failed.';
  }
};

</script>

<style scoped>
.service-url-container {
  margin-bottom: 16px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 16px;
}

.service-url-title {
  margin: 0 0 4px 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.service-url-description {
  margin: 0 0 20px 0;
  font-size: 12px;
  color: var(--vscode-editorHint-foreground);
  line-height: 1.4;
}

.active-port-hint {
  font-size: 12px;
  font-weight: 400;
  color: var(--vscode-charts-green);
  margin-left: 8px;
}

.service-url-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.service-port-container {
  flex-shrink: 0;
}

.service-port-input {
  min-width: 80px;
  height: 32px;
}

.url-input-container {
  flex: 3;
}

.url-input {
  width: 100%;
}

.url-input .control {
  height: 32px;
}

.path-input-container {
  flex: 1;
  flex-shrink: 0;
}

.path-input {
  width: 100%;
  height: 32px;
}

.buttons-container {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.tunnel-button {
  min-width: 80px;
  height: 32px;
  font-weight: 500;
}

.tunnel-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.test-button {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);

  --border-width: 0;
}

.test-button:hover:not(:disabled) {
  background: var(--vscode-button-secondaryHoverBackground);
}

.test-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.codicon {
  font-size: 16px;
}

/* Error Message */
.error-message {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0 0;
  background-color: var(--vscode-editorError-background);
  border: 1px solid var(--vscode-editorError-border);
  border-radius: 6px;
}

.error-icon {
  width: 14px;
  height: 14px;
  font-size: 14px;
  color: var(--vscode-editorError-foreground);
  flex-shrink: 0;
  margin-top: 1px;
}

.error-text {
  font-size: 13px;
  color: var(--vscode-editorError-foreground);
  line-height: 1.4;
}

/* Diagnostics Section */
.diagnostics-section {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  background-color: var(--vscode-editor-background);
}

.diagnostics-title {
  margin: 0 0 16px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.diagnostics-status {
  margin-bottom: 16px;
}

.status-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  border-radius: 6px;
  border: 1px solid var(--vscode-panel-border);
}

.status-item.running {
  background-color: var(--vscode-editorInfo-background);
  border-color: var(--vscode-editorInfo-border);
}

.status-item.success {
  background-color: var(--vscode-testing-iconPassed);
  border-color: var(--vscode-charts-green);
  color: var(--vscode-charts-green);
}

.status-item.failed {
  background-color: var(--vscode-editorError-background);
  border-color: var(--vscode-editorError-border);
}

.status-indicator {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--vscode-panel-border);
  border-top: 2px solid var(--vscode-progressBar-background);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.success-icon {
  width: 16px;
  height: 16px;
  color: var(--vscode-charts-green);
}

.status-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.status-description {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.4;
}

.status-actions {
  flex-shrink: 0;
  margin-top: 8px;
}

.retry-diagnostics-button {
  min-width: 120px;
  height: 28px;
  font-size: 12px;
  transition: all 0.2s ease;
}

.retry-diagnostics-button:disabled {
  opacity: 0.7;
  cursor: not-allowed;
  background-color: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

/* Diagnostics Stages */
.diagnostics-stages {
  margin-top: 16px;
}

.stages-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--vscode-foreground);
  margin-bottom: 12px;
}

.stages-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stage-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 4px;
  background-color: var(--vscode-editor-inactiveSelectionBackground);
  border: 1px solid var(--vscode-panel-border);
}

.stage-item.stage-pass {
  background-color: var(--vscode-testing-iconPassed);
  border-color: var(--vscode-charts-green);
}

.stage-item.stage-fail {
  background-color: var(--vscode-editorError-background);
  border-color: var(--vscode-editorError-border);
}

.stage-status {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stage-icon {
  font-size: 12px;
  font-weight: bold;
  border-radius: 50%;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stage-icon.pass {
  background-color: var(--vscode-charts-green);
  color: white;
}

.stage-icon.fail {
  background-color: var(--vscode-charts-red);
  color: white;
}

.stage-icon.pending {
  background-color: var(--vscode-panel-border);
  color: var(--vscode-foreground);
}

.stage-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stage-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.stage-description {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.3;
}

.stage-result {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  font-style: italic;
  margin-top: 2px;
}
</style>
