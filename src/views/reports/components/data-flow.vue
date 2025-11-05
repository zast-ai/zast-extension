<template>
  <div class="data-flow-vul">
    <!-- Data Flow Section -->
    <div class="data-flow-section">
      <h4>Data Flow</h4>
      <table class="data-flow-table">
        <thead>
          <tr>
            <th>Step</th>
            <th>Location</th>
            <th>Code</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(step, index) in parsedSteps" :key="index">
            <td class="step-number">{{ index + 1 }}</td>
            <td class="location-info">
              <div class="file-path clickable" @click.stop="openFileAtLine(step.file_uri, step.start_line)">
                {{ getFileName(step.file_uri) }}
              </div>
              <div class="line-info">Line {{ step.start_line }}</div>
            </td>
            <td class="code-content">
              <pre class="code-snippet">{{ step.code }}</pre>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { vscodeApi } from '../../../utils/index';

interface Props {
  issueDetail: {
    code_flow: Array<{
      file_uri: string;
      start_line: number;
      start_column: number;
      end_column: number;
    }>;
    code_snippet: string[];
  };
}

const props = defineProps<Props>();

// Parse code snippets to extract relevant code for each step
const parsedSteps = computed(() => {
  if (!props.issueDetail?.code_flow || !props.issueDetail?.code_snippet) {
    return [];
  }

  const codeFlow = props.issueDetail.code_flow;
  const codeSnippets = props.issueDetail.code_snippet;

  // Parse code snippets to find code blocks
  const codeBlocks: { [key: string]: string[] } = {};
  let currentFile = '';
  let currentLines: string[] = [];

  for (const snippet of codeSnippets) {
    if (typeof snippet !== 'string') continue;

    // Check if this is a file header comment
    const fileHeaderMatch = snippet.match(/\/\/ (.+?)#L(\d+)-L(\d+)/);
    if (fileHeaderMatch) {
      // Save previous file's code if exists
      if (currentFile && currentLines.length > 0) {
        codeBlocks[currentFile] = currentLines;
      }

      currentFile = fileHeaderMatch[1];
      currentLines = [];
    }

    // If it's actual code content, add to current lines
    if (snippet.trim() && !snippet.startsWith('\n\n') && currentFile) {
      const lines = snippet.split('\n').filter(line => line.trim());
      currentLines.push(...lines);
    }
  }

  // Save the last file's code
  if (currentFile && currentLines.length > 0) {
    codeBlocks[currentFile] = currentLines;
  }

  // Map each code flow step to its corresponding code
  return codeFlow.map((step) => {
    const fileLines = codeBlocks[step.file_uri] || [];

    // Find the line that matches the step's line number
    let code = '';
    for (const line of fileLines) {
      const lineMatch = line.match(/^(\d+):\s*(.*)$/);
      if (lineMatch) {
        const lineNumber = parseInt(lineMatch[1]);
        if (lineNumber === step.start_line) {
          code = lineMatch[2];
          break;
        }
      }
    }

    // If no exact match found, try to find the closest line
    if (!code && fileLines.length > 0) {
      // Look for any line that contains meaningful code around the target line
      for (const line of fileLines) {
        const lineMatch = line.match(/^(\d+):\s*(.*)$/);
        if (lineMatch) {
          const lineNumber = parseInt(lineMatch[1]);
          const lineCode = lineMatch[2].trim();
          if (Math.abs(lineNumber - step.start_line) <= 2 && lineCode) {
            code = lineCode;
            break;
          }
        }
      }
    }

    return {
      ...step,
      code: code || 'Code not available'
    };
  });
});

// Extract filename from full path
const getFileName = (filePath: string): string => {
  const parts = filePath.split('/');
  return parts[parts.length - 1];
};

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
</script>

<style scoped>
.data-flow-vul {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.data-flow-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.data-flow-section h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.data-flow-table {
  width: 100%;
  border-collapse: collapse;
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-input-background);
}

.data-flow-table th,
.data-flow-table td {
  padding: 8px;
  text-align: left;
  border-bottom: 1px solid var(--vscode-panel-border);
  border-right: none;
  font-size: 12px;
}

.data-flow-table th {
  background: var(--vscode-textCodeBlock-background);
  color: var(--vscode-foreground);
  font-weight: 600;
}

.step-number {
  width: 60px;
  text-align: center;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.location-info {
  min-width: 200px;
}

.file-path {
  color: var(--vscode-textLink-foreground);
  font-family: var(--vscode-editor-font-family);
  cursor: pointer;
  transition: all 0.2s ease;
  font-weight: 500;
}

.file-path:hover {
  text-decoration: underline;
  opacity: 0.8;
}

.line-info {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-top: 2px;
}

.code-content {
  max-width: 400px;
}

.code-snippet {
  margin: 0;
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  line-height: 1.4;
  color: var(--vscode-editor-foreground);
  white-space: pre-wrap;
  word-wrap: break-word;
  background: var(--vscode-inputOption-activeBackground);
  padding: 4px 8px;
  border-radius: 4px;
}

.clickable {
  cursor: pointer;
}
</style>
