<template>
  <div class="idor-vul">
    <!-- Request Information Section -->
    <div class="idor-section">
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
            <td>Request Body</td>
            <td>{{ postData }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Response Information Section -->
    <div class="idor-section" v-if="responseData.length > 0">
      <h4>Response Information</h4>
      <table class="info-table">
        <thead>
          <tr>
            <th>Account Role</th>
            <th>Response Body</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in responseData" :key="item.accountRole">
            <td>{{ item.accountRole }}</td>
            <td>{{ item.responseBody }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Response Similarities Section -->
    <div class="idor-section" v-if="similarityData.length > 0">
      <h4>Response Similarities</h4>
      <table class="info-table">
        <thead>
          <tr>
            <th>Original Account</th>
            <th>Attack Account</th>
            <th>Similarity</th>
            <th>Is Vulnerable</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in similarityData" :key="`${item.originalAccount}-${item.attackAccount}`">
            <td>{{ item.originalAccount }}</td>
            <td>{{ item.attackAccount }}</td>
            <td>{{ item.similarity }}</td>
            <td>
              <span class="tag" :class="{ 'vulnerable': item.isVulnerable === 'YES', 'safe': item.isVulnerable === 'NO' }">
                {{ item.isVulnerable }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Detection Criteria Section -->
    <div class="idor-section" v-if="detectionCriteria">
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
        accountRole: 'Administrator',
        responseBody: output.responses?.original || '-'
      },
      {
        accountRole: 'Normal User',
        responseBody: output.responses?.attacker || '-'
      },
      {
        accountRole: 'Guest',
        responseBody: output.responses?.unauthenticated || '-'
      }
    ];
  } catch (e) {
    console.warn('Failed to parse pocScriptOutput:', e);
    return [];
  }
});

const similarityData = computed(() => {
  if (!props.issueDetail.pocScriptOutput) return [];
  try {
    const output = JSON.parse(props.issueDetail.pocScriptOutput);
    const similarities = output.similarities || {};
    return [
      {
        originalAccount: 'Administrator',
        attackAccount: 'Normal User',
        similarity: similarities.originalVsAttacker?.similarity || '-',
        isVulnerable: similarities.originalVsAttacker?.isAboveThreshold ? 'YES' : 'NO'
      },
      {
        originalAccount: 'Administrator',
        attackAccount: 'Guest',
        similarity: similarities.originalVsUnauthenticated?.similarity || '-',
        isVulnerable: similarities.originalVsUnauthenticated?.isAboveThreshold ? 'YES' : 'NO'
      },
      {
        originalAccount: 'Normal User',
        attackAccount: 'Guest',
        similarity: similarities.attackerVsUnauthenticated?.similarity || '-',
        isVulnerable: similarities.attackerVsUnauthenticated?.isAboveThreshold ? 'YES' : 'NO'
      }
    ];
  } catch (e) {
    console.warn('Failed to parse pocScriptOutput:', e);
    return [];
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
</script>

<style scoped>
.idor-vul {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.idor-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.idor-section h4 {
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

.tag {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.tag.vulnerable {
  background: #ff4444;
  color: white;
}

.tag.safe {
  background: #00aa00;
  color: white;
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
