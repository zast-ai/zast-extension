<template>
<div class="sink-vul">
  <!-- Source Location Section -->
  <div class="sink-section" v-if="issueDetail.source">
    <h4>Source Location</h4>
    <div class="location-info">
      <div class="file-path clickable"
        @click.stop="openFileAtLine(issueDetail.source?.file, issueDetail.source?.location?.start_line)">
        {{ issueDetail.source?.file }}L{{ issueDetail.source?.location?.start_line }}
      </div>
    </div>
    <div class="code-snippet" v-if="issueDetail.source?.code_snippet" @click.stop>
      <pre>{{ issueDetail.source.code_snippet }}</pre>
    </div>
  </div>

  <!-- Sink Location Section -->
  <div class="sink-section" v-if="issueDetail.sink">
    <h4>Sink Location</h4>
    <div class="location-info">
      <div class="file-path clickable"
        @click.stop="openFileAtLine(issueDetail.sink?.file, issueDetail.sink?.location?.start_line)">
        {{ issueDetail.sink?.file }}L{{ issueDetail.sink?.location?.start_line }}
      </div>
    </div>
    <div class="code-snippet" v-if="issueDetail.sink?.code_snippet" @click.stop>
      <pre>{{ issueDetail.sink.code_snippet }}</pre>
    </div>
  </div>

  <DataFlowComponent v-if="showDataFlow" :issueDetail="dataFlowInfo" />

  <!-- POC Script Section -->
  <div class="sink-section" v-if="issueDetail.pocScript">
    <h4>Proof of Concept</h4>
    <div class="code-title">
      <h5>{{ pocLanguage }}</h5>
      <!-- <button class="copy-btn" @click.stop="copyToClipboard(issueDetail.pocScript)">Copy</button> -->
    </div>
    <div class="code-block code-poc">
      <pre>{{ issueDetail.pocScript }}</pre>
    </div>
  </div>

  <!-- POC Output Section -->
  <div class="sink-section" v-if="issueDetail.pocScriptOutput">
    <h4>Proof Execution Result</h4>
    <div class="code-block">
      <pre>{{ issueDetail.pocScriptOutput }}</pre>
    </div>
  </div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { vscodeApi } from '../../../utils/index';
import DataFlowComponent from './data-flow.vue';

interface Props {
  issueDetail: any;
  hasSource?: boolean;
}

const props = defineProps<Props>();

// Open file at specific line
const openFileAtLine = (filePath: string, lineNumber: number) => {
  vscodeApi.post('openFileAtLine', {
    type: 'openFileAtLine',
    data: {
      filePath: filePath,
      lineNumber: lineNumber
    }
  });
};

const pocLanguage = computed(() => {
  const pocScript = props.issueDetail.pocScript;
  if (!pocScript || typeof pocScript !== 'string') {
    return 'text';
  }

  const code = pocScript.toLowerCase().trim();

  if (code.includes('public class') || code.includes('import java.') || code.includes('system.out.') || code.includes('public static void main') || /class\s+\w+\s*\{/.test(pocScript)) {
    return 'Java';
  }

  // Curl detection
  if (code.startsWith('curl ') || code.includes('curl -') || /curl\s+(-[a-z]|\\-\\-[a-z])/i.test(code)) {
    return 'Bash';
  }

  // Python detection
  if (
    code.includes('import ') ||
    code.includes('def ') ||
    code.includes('print(') ||
    code.includes('if __name__ == "__main__"') ||
    code.includes('requests.') ||
    code.includes('urllib') ||
    /^\s*(import|from|def|class|if|for|while|try|except)\s/m.test(pocScript)
  ) {
    return 'Python';
  }

  // HTML detection
  if (code.includes('<!doctype') || code.includes('<html>') || code.includes('<body>') || code.includes('<head>') || code.includes('<script>')) {
    return 'HTML';
  }

  return 'Text';
});

const dataFlowInfo = computed(() => {
  return {
    code_flow: props.issueDetail.codeFlow || [],
    code_snippet: props.issueDetail.codeSnippet || []
  }
})

const showDataFlow = computed(() => {
  return props.hasSource && props.issueDetail.codeFlow && props.issueDetail.codeFlow.length > 0;
});
</script>

<style scoped>
.sink-vul {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sink-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sink-section h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.location-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-path {
  font-size: 12px;
  color: var(--vscode-textLink-foreground);
  font-family: var(--vscode-editor-font-family);
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-path:hover {
  text-decoration: underline;
  opacity: 0.8;
}

.code-snippet {
  background: var(--vscode-textCodeBlock-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 8px;
  overflow-x: auto;
  margin-top: 8px;
}

.code-snippet pre {
  margin: 0;
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  line-height: 1.4;
  color: var(--vscode-editor-foreground);
  white-space: pre-wrap;
  word-wrap: break-word;
}

.code-wrapper {
  margin-top: 8px;
}

.code-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--vscode-textCodeBlock-background);
  border: 1px solid var(--vscode-panel-border);
  border-bottom: none;
  border-top-left-radius: 4px;
  border-top-right-radius: 4px;
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

.code-poc {
  margin-top: -8px;
  border-top-left-radius: 0;
  border-top-right-radius: 0;
  border-top: none;
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
