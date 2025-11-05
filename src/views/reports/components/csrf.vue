<template>
  <div class="csrf-vul">
    <!-- Request Information Section -->
    <div class="csrf-section">
      <h4>Request Information</h4>
      <table class="info-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Information</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>URL</td>
            <td>{{ issueDetail.apiPath }}</td>
          </tr>
          <tr>
            <td>Method</td>
            <td>{{ issueDetail.apiMethod }}</td>
          </tr>
          <tr>
            <td>Request Headers</td>
            <td>{{ formatHeaders(requestHeaders) }}</td>
          </tr>
          <tr>
            <td>Request Body</td>
            <td>{{ postData }}</td>
          </tr>
          <tr>
            <td>Account Role</td>
            <td>Administrator</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Response Information Section -->
    <div class="csrf-section" v-if="responseData.length > 0">
      <h4>Response Information</h4>
      <table class="info-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Information</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in responseData" :key="item.item">
            <td>{{ item.item }}</td>
            <td>{{ item.information }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- POC Script Section -->
    <div class="csrf-section" v-if="pocHtml">
      <h4>Proof of Concept</h4>
      <!-- <div class="code-title">
        <h5>HTML</h5>
        <button class="copy-btn" @click="copyToClipboard(pocHtml)">Copy</button>
      </div> -->
      <div class="code-block">
        <pre>{{ pocHtml }}</pre>
      </div>
    </div>

    <!-- Detection Criteria Section -->
    <div class="csrf-section" v-if="detectionCriteria">
      <h4>Detection Criteria</h4>
      <div class="code-block">
        <pre>{{ detectionCriteria }}</pre>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';

interface Props {
  issueDetail: any;
}

const props = defineProps<Props>();

const requestHeaders = computed(() => {
  if (!props.issueDetail.pocScript) return '-';
  try {
    const pocData = JSON.parse(props.issueDetail.pocScript);
    return pocData.headers || '-';
  } catch (e) {
    console.warn('Failed to parse pocScript:', e);
    return '-';
  }
});

const postData = computed(() => {
  if (!props.issueDetail.pocScript) return '-';
  try {
    const pocData = JSON.parse(props.issueDetail.pocScript);
    return pocData.postData || '-';
  } catch (e) {
    console.warn('Failed to parse pocScript:', e);
    return '-';
  }
});

const responseData = computed(() => {
  if (!props.issueDetail.pocScriptOutput) return [];
  try {
    const output = JSON.parse(props.issueDetail.pocScriptOutput);
    return [
      {
        item: 'Response Body',
        information: output.responses?.original || '-'
      },
      {
        item: 'Status Code',
        information: output.statusCodes?.original || '-'
      }
    ];
  } catch (e) {
    console.warn('Failed to parse pocScriptOutput:', e);
    return [];
  }
});

const pocHtml = computed(() => {
  if (!props.issueDetail.pocScriptOutput) return '';
  try {
    const output = JSON.parse(props.issueDetail.pocScriptOutput);
    const pocStr = output.poc;
    if (pocStr) {
      // Extract code content from markdown code block format "```html\nCode\n```"
      const codeBlockMatch = pocStr.match(/```html\n([\s\S]*?)\n```/);
      if (codeBlockMatch) {
        return codeBlockMatch[1].replace(/\\n/g, '\n');
      }
      return pocStr.replace(/\\n/g, '\n');
    }
    return '';
  } catch (error) {
    console.error('Failed to parse POC script output:', error);
    return '';
  }
});

const detectionCriteria = computed(() => {
  if (!props.issueDetail.pocScriptOutput) return '';
  try {
    const output = JSON.parse(props.issueDetail.pocScriptOutput);
    return output.reasoning || '';
  } catch (error) {
    console.error('Failed to parse POC script output:', error);
    return '';
  }
});

const formatHeaders = (headers: any): string => {
  if (headers === '-' || !headers) return '-';
  if (typeof headers === 'string') return headers;
  try {
    return JSON.stringify(headers);
  } catch (e) {
    return String(headers);
  }
};

// const copyToClipboard = (text: string) => {
//   navigator.clipboard.writeText(text).then(() => {
//     console.log('Copied to clipboard');
//   }).catch(err => {
//     console.error('Failed to copy: ', err);
//   });
// };
</script>

<style scoped>
.csrf-vul {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.csrf-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.csrf-section h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.info-table {
  width: 100%;
  border-collapse: collapse;
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-input-background);
}

.info-table th,
.info-table td {
  padding: 8px;
  text-align: left;
  border: 1px solid var(--vscode-panel-border);
  font-size: 12px;
}

.info-table th {
  background: var(--vscode-textCodeBlock-background);
  color: var(--vscode-foreground);
  font-weight: 600;
}

.info-table td {
  color: var(--vscode-foreground);
  word-wrap: break-word;
  max-width: 300px;
}

.code-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--vscode-textCodeBlock-background);
  border: 1px solid var(--vscode-panel-border);
  border-bottom: none;
}

.code-title h5 {
  margin: 0;
  font-size: 12px;
  color: var(--vscode-foreground);
}

.copy-btn {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 10px;
}

.copy-btn:hover {
  background: var(--vscode-button-hoverBackground);
}

.code-block {
  background: var(--vscode-textCodeBlock-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 12px;
  overflow-x: auto;
}

.code-block pre {
  margin: 0;
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  line-height: 1.4;
  color: var(--vscode-editor-foreground);
  white-space: pre-wrap;
  word-wrap: break-word;
}
</style>