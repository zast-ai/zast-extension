<template>
<div class="app">
  <div class="reports-container">
    <div class="reports-header">
      <h3>SBOM(Software Bill of Materials) Security Reports</h3>
      <div class="reports-stats" v-if="reports.length > 0">
        <span class="total-count">{{ reports.length }} issues</span>
      </div>
    </div>

    <div v-if="loading" class="loading">
      <div class="loading-spinner"></div>
      Loading reports...
    </div>

    <div v-else-if="error" class="error">
      <span class="error-icon">⚠</span>
      {{ error }}
    </div>

    <div v-else-if="reports.length === 0" class="no-issues">
      <span class="no-issues-icon">✓</span>
      No issues found
    </div>

    <div v-else class="issues-list">
      <div v-for="report in reports" :key="report.ID" class="issue-item" :class="{
        'expanded': expandedReports.has(report.ID)
      }" @click="toggleReport(report.ID)">
        <div class="issue-header">
          <div class="issue-icon">
            <span class="severity-icon" :class="getSeverityClass(report.Severity)">
              {{ getSeverityIcon(report.Severity) }}
            </span>
          </div>
          <div class="issue-content">
            <div class="issue-title">{{ report.additionalData.title }}</div>
            <div class="issue-meta">
              <span class="issue-vulid">ID: {{ report.ID }}</span>
              <span v-if="report.CVEs?.length" class="issue-cwe">CVE: {{ report.CVEs.join(', ') }}</span>
            </div>
          </div>
          <div class="issue-severity">
            <span class="severity-badge" :class="getSeverityClass(report.Severity)">
              {{ getSeverityString(report.Severity) }}
            </span>
          </div>
          <div class="expand-icon">
            <span :class="{ 'expanded': expandedReports.has(report.ID) }">
              {{ expandedReports.has(report.ID) ? '▼' : '▶' }}
            </span>
          </div>
        </div>

        <div v-if="expandedReports.has(report.ID)" @click.stop class="issue-details">
          <main>
            <div class="report-section">
              <div class="grid-container">
                <div class="grid-item">
                  <span class="grid-label">Vulnerable module</span>
                  <span class="grid-value code-font">{{ report.additionalData.name }}</span>
                </div>
                <div class="grid-item">
                  <span class="grid-label">Introduced through</span>
                  <span class="grid-value code-font">{{ report.additionalData.version }}</span>
                </div>
                <div class="grid-item">
                  <span class="grid-label">Fixed in</span>
                  <span class="grid-value code-font">{{ report.additionalData.fixedIn?.join(', ') || 'Not available'
                    }}</span>
                </div>
                <div class="grid-item">
                  <span class="grid-label">Exploit maturity</span>
                  <span class="grid-value code-font">{{ report.additionalData.exploit }}</span>
                </div>
              </div>
            </div>

            <div v-if="report.additionalData.from?.length || report.additionalData.remediation" class="report-section">
              <h2>Detailed paths</h2>
              <div class="grid-container">
                <div v-if="report.additionalData.from?.length" class="grid-item full-width">
                  <span class="grid-label">Introduced through</span>
                  <span class="grid-value code-font">{{ report.additionalData.from?.join(' > ') }}</span>
                </div>
                <div v-if="report.additionalData.remediation" class="grid-item full-width">
                  <span class="grid-label">Remediation</span>
                  <span class="grid-value">{{ report.additionalData.remediation }}</span>
                </div>
              </div>
            </div>

            <div class="report-section">
              <h2>OVERVIEW</h2>
              <p>{{ report.additionalData.description }}</p>
            </div>

            <div class="report-section">
              <h2>REMEDIATION</h2>
              <p>{{ report.additionalData.remediation }}</p>
            </div>

            <div class="report-section" v-if="report.additionalData.references?.length">
              <h2>REFERENCES</h2>
              <ul>
                <li v-for="ref in report.additionalData.references" :key="ref.Url">
                  <a href="#" @click.prevent="openLink(ref.Url)">{{ ref.Title }}</a>
                </li>
              </ul>
            </div>
          </main>
        </div>
      </div>
    </div>
  </div>
</div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { vscodeApi } from '../../utils/index';

const reports = ref([]);
const loading = ref(false);
const error = ref('');
const expandedReports = ref(new Set());

const getSeverityClass = (severity) => {
  switch (severity) {
    case 1: return 'severity-critical';
    case 2: return 'severity-high';
    case 3: return 'severity-medium';
    case 4: return 'severity-low';
    default: return 'severity-unknown';
  }
};

const getSeverityIcon = (severity) => {
  switch (severity) {
    case 1:
    case 2:
    case 3:
    case 4:
      return '⚠';
    default:
      return '?';
  }
};

const getSeverityString = (severity) => {
  switch (severity) {
    case 1: return 'Critical';
    case 2: return 'High';
    case 3: return 'Medium';
    case 4: return 'Low';
    default: return 'Unknown';
  }
};

const toggleReport = (reportId) => {
  if (expandedReports.value.has(reportId)) {
    expandedReports.value.delete(reportId);
  } else {
    expandedReports.value.add(reportId);
  }
};

const openLink = (url) => {
  vscodeApi.post('openExternalLink', { url });
};

onMounted(() => {
  vscodeApi.on('updateSbomReport', (data) => {
    loading.value = false;
    if (data.reports) {
      reports.value = data.reports;
      error.value = '';
    } else {
      reports.value = [];
      error.value = data.error || 'Failed to load SBOM reports.';
      console.error('Error loading SBOM report:', data.error);
    }
  });

  // Request data on load
  loading.value = true;
  vscodeApi.post({ type: 'refreshReports' });
});
</script>

<style scoped>
/* Copied and adapted styles from reports/App.vue and existing sbom-report/App.vue */
.app {
  padding: 1rem;
  color: var(--vscode-editor-foreground);
  background-color: var(--vscode-editor-background);
  font-family: var(--vscode-font-family);
  height: 100vh;
  overflow-y: auto;
}

.reports-container {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background-color: var(--vscode-editor-background);
  height: 100%;
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

main {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 12px 0;
}

.report-section {
  border-top: 1px solid var(--vscode-editor-separator-background);
  padding-top: 1.5rem;
}

.report-section:first-child {
  border-top: none;
  padding-top: 0;
}

h2 {
  font-size: 0.8rem;
  font-weight: bold;
  text-transform: uppercase;
  color: var(--vscode-text-separator-foreground);
  margin-bottom: 1rem;
  margin-top: 0;
}

.grid-container {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}

.grid-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.grid-item.full-width {
  grid-column: 1 / -1;
}

.grid-label {
  font-size: 0.875rem;
  color: var(--vscode-text-separator-foreground);
}

.grid-value {
  flex: 1;
  font-size: 0.875rem;
}

.code-font {
  font-family: var(--vscode-editor-font-family);
  background-color: var(--vscode-textBlockQuote-background);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
}

p {
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 0;
}

ul {
  list-style: disc;
  padding-left: 1.5rem;
  margin: 0;
}

li {
  margin-bottom: 0.5rem;
}

a {
  color: var(--vscode-textLink-foreground);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

.loading-container {
  text-align: center;
  padding: 2rem;
}
</style>