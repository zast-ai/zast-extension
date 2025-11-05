<template>
  <div class="artifact-container">
    <h3 class="artifact-title">Deployment Artifact
      <span v-if="artifactCount > 0" class="artifact-count">
        {{ artifactCount }} artifacts available
      </span>
    </h3>

    <p class="artifact-description">
      Select the deployment artifact to analyze for security vulnerabilities
    </p>

    <div class="artifact-content">
      <div class="main-content">
        <div class="select-section">
          <label class="select-label">Select Artifact</label>
          <div class="select-artifact-container">
            <vscode-dropdown :value="selectedArtifact" @change="handleArtifactChange" class="artifact-dropdown">
              <vscode-option value="">Web Application Artifact</vscode-option>
              <vscode-option v-for="artifact in props.artifactList" :key="artifact.path" :value="artifact.name">
                {{ artifact.type === 'folder' ? '📁' : '📄' }} {{ artifact.name }}
              </vscode-option>
            </vscode-dropdown>
            <vscode-button @click="refreshArtifacts" class="refresh-button" title="Refresh artifacts">
              Refresh
            </vscode-button>
          </div>
        </div>

        <!-- Selected Files Display -->
        <div v-if="hasSelectedContent" class="selected-files-display">
          <div class="file-icon-container">
            <span class="file-icon">
              {{ isFolder ? '📁' : '📄' }}
            </span>
            <div class="file-info">
              <span class="file-title">Selected {{ isFolder ? 'Fold' : 'Artifact' }}:</span>
              <div v-if="selectionMode === 'dropdown' && selectedArtifactItem" class="file-name">
                {{ selectedArtifactItem.name }}
                <span v-if="selectedArtifactItem.size">({{ formatFileSize(selectedArtifactItem.size) }})</span>
              </div>
              <div v-if="selectionMode === 'browse' && selectedManualItem" class="file-name">
                {{ selectedManualItem.name }}
                <span v-if="selectedManualItem.type === 'file'">
                  ({{ formatFileSize(selectedManualItem.size) }})
                </span>
              </div>
            </div>
          </div>
        </div>

        <vscode-checkbox :checked="uploadSourceCode" :disabled="selectionMode === 'browse' || isSourceOnlyLanguage"
          @checkedChanged="handleUploadSourceCodeChange" class="source-code-checkbox">
          <span>Source code upload to improve the accuracy of the vulnerability assess report</span>
          <span v-if="isSourceOnlyLanguage" class="required-note">(Required for {{ selectedArtifactItem?.language }}
            projects)</span>
        </vscode-checkbox>
      </div>

      <div class="button-container">
        <vscode-button @click="selectMoreFiles" class="browse-files-button" appearance="secondary"
          title="Browse and upload your own artifact files">
          <svg class="icon browse-files-icon" aria-hidden="true">
            <use xlink:href="#icon-upload"></use>
          </svg>
          Browse Files
        </vscode-button>
      </div>
    </div>

    <div class="tip-text">
      <span class="tip-text-bold">Tip:</span> You can either select from the dropdown above or browse and upload your
      own artifact files.
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { showAlertDialog, vscodeApi } from '../../../utils/index';

export interface ArtifactItem {
  name: string;
  path: string;
  size: number;
  sourceCodePaths: string[];
  language: 'java' | 'javascript' | 'python';
  type: 'file' | 'folder';
}

// Props definition
interface Props {
  artifactList: ArtifactItem[];
  refresh: () => void;
  onchange?: (selectedArtifact: ArtifactItem | null, uploadSourceCode: boolean, additionalFiles?: { path: string, type: 'file' | 'folder' }[], language?: string) => void;
}

const props = defineProps<Props>();

// Reactive state
const selectedArtifact = ref('');
const uploadSourceCode = ref(true); // Default to true (checked)
const selectedManualItems = ref<{ path: string; size: number; type: 'file' | 'folder'; name: string }[]>([]);
const selectionMode = ref<'none' | 'dropdown' | 'browse'>('none'); // Track selection mode

// Computed properties
const selectedArtifactItem = computed(() => {
  return props.artifactList.find(artifact => artifact.name === selectedArtifact.value) || null;
});

const selectedManualItem = computed(() => {
  if (selectionMode.value === 'browse' && selectedManualItems.value.length > 0) {
    return selectedManualItems.value[0];
  }
  return null;
});

const isFolder = computed(() => {
  if (selectionMode.value === 'browse' && selectedManualItem.value) {
    return selectedManualItem.value.type === 'folder';
  } else if (selectionMode.value === 'dropdown' && selectedArtifactItem.value) {
    return selectedArtifactItem.value.type === 'folder';
  }
  return false;
});

const hasSelectedContent = computed(() => {
  return (selectionMode.value === 'dropdown' && selectedArtifact.value) ||
    (selectionMode.value === 'browse' && selectedManualItems.value.length > 0);
});

const artifactCount = computed(() => {
  return props.artifactList.length;
});

// Check if selected artifact is a source-only language (JS/Python)
const isSourceOnlyLanguage = computed(() => {
  const artifact = selectedArtifactItem.value;
  return artifact && (artifact.language === 'javascript' || artifact.language === 'python');
});

// Methods
const handleArtifactChange = (event: Event) => {
  const target = event.target as HTMLSelectElement;
  selectedArtifact.value = target.value;

  if (target.value) {
    // Switch to dropdown mode and clear browse selection
    selectionMode.value = 'dropdown';
    selectedManualItems.value = [];
    uploadSourceCode.value = true;
  } else {
    selectionMode.value = 'none';
  }
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const handleUploadSourceCodeChange = (_oldValue: boolean, newValue: boolean) => {
  console.log('handleUploadSourceCodeChange', newValue);
  uploadSourceCode.value = newValue;
};

const refreshArtifacts = async () => {
  try {
    console.log('Refreshing artifacts...');
    await props.refresh();
  } catch (err) {
    console.error('Failed to refresh artifacts:', err);
    showAlertDialog('Error', 'Failed to refresh artifacts');
  }
};

const selectMoreFiles = async () => {
  try {
    console.log('Opening file selector...');

    const message = {
      type: 'selectFiles',
      data: {
        title: 'Select source code folder or artifact for analysis',
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: true,
        filters: {
          'Java': ['jar', 'war'],
        }
      }
    };

    vscodeApi.postMessage(message);
  } catch (err) {
    console.error('Failed to open file selector:', err);
    showAlertDialog('Error', 'Failed to open file selector');
  }
};

watch(props.artifactList, (newVal) => {
  console.log('artifactList changed:', newVal);
});

// Helper function to trigger onchange callback
const triggerOnChange = () => {
  const selectedArtifactItem = props.artifactList.find(artifact => artifact.name === selectedArtifact.value) || null;
  console.log('selectedArtifactItem', selectedArtifactItem);
  const language = selectedArtifactItem?.language;

  const additionalFiles = selectedManualItems.value.map(item => ({
    path: item.path,
    type: item.type,
  }));

  props.onchange?.(selectedArtifactItem, uploadSourceCode.value, additionalFiles, language);
};

// Watch selectedArtifact for changes and call onchange callback
watch([selectedArtifact, uploadSourceCode, selectedManualItems], () => {
  triggerOnChange();
});

// VS Code webview message listeners (replace window.addEventListener usage)
const onFilesSelected = (data: { selections?: { path: string; size: number; type: 'file' | 'folder'; name: string }[] }) => {
  console.log('Files selected:', data);
  const selections = data?.selections || [];
  if (selections.length > 0) {
    // Switch to browse mode
    selectionMode.value = 'browse';
    selectedManualItems.value = selections;
    // Clear dropdown selection
    selectedArtifact.value = '';
    // For folder selection (JS/Python), keep source code enabled
    // For file selection (Java), disable source code
    const isFolder = selections.length === 1 && selections[0].type === 'folder';
    uploadSourceCode.value = isFolder;
  }
};

const onFileSelectionCancelled = () => {
  console.log('File selection cancelled');
};

const onFileSelectionError = (data: { error?: string }) => {
  console.error('File selection error:', data);
  showAlertDialog('Error', `Failed to open file selector: ${data?.error ?? 'Unknown error'}`);
};

vscodeApi.on('filesSelected', onFilesSelected);
vscodeApi.on('fileSelectionCancelled', onFileSelectionCancelled);
vscodeApi.on('fileSelectionError', onFileSelectionError);

</script>

<style scoped>
.artifact-container {
  margin-bottom: 16px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 16px;
}

.artifact-title {
  margin: 0 0 4px 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.artifact-count {
  margin-left: 1em;
  font-size: 12px;
  font-weight: normal;
  color: var(--vscode-charts-green);
  padding: 4px 8px;
  border-radius: 4px;
  background-color: var(--vscode-editorStickyScrollHover-background);
}

.artifact-description {
  margin: 6px 0 20px 0;
  font-size: 12px;
  color: var(--vscode-editorHint-foreground);
  line-height: 1.4;
}

.artifact-content {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
}

.main-content {
  width: 100%;
}

.select-section {
  margin-bottom: 12px;
}

.select-label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.select-artifact-container {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.artifact-dropdown {
  flex: 1;
  height: 32px;
}

.artifact-dropdown:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.selected-files-display {
  margin: 16px 0;
  padding: 12px 16px;
  background: #e6f3ff;
  border: 1px solid #b3d9ff;
  border-radius: 4px;
}

.file-icon-container {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-icon {
  font-size: 16px;
  color: #0078d4;
}

.file-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-title {
  font-size: 14px;
  font-weight: 500;
  color: #0078d4;
}

.file-name {
  font-size: 14px;
  color: #323130;
  font-weight: 500;
}

.source-code-checkbox {
  margin-top: 0;
}

.source-code-checkbox:disabled {
  opacity: 0.6;
}

.button-container {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 120px;
}

.refresh-button,
.browse-files-button {
  height: 32px;
  font-weight: 500;
}

.browse-files-icon {
  margin-right: 6px;
  font-size: 14px;
}

.refresh-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tip-text {
  margin-top: 16px;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 4px;
  background: var(--vscode-editorStickyScrollHover-background);
  color: var(--vscode-foreground);

  .tip-text-bold {
    font-weight: bold;
  }
}

/* Checkbox styles */
vscode-checkbox {
  margin-top: 8px;
}

vscode-checkbox span {
  line-height: 1.4;
  color: var(--vscode-foreground);
  font-size: 13px;
}

vscode-checkbox:disabled span {
  color: var(--vscode-disabledForeground);
}

.required-note {
  font-style: italic;
  color: var(--vscode-charts-orange);
  margin-left: 8px;
}

/* VSCode theme adaptations */
@media (prefers-color-scheme: dark) {
  .selected-files-display {
    background: #1a3d5c;
    border-color: #3794d1;
  }

  .file-title {
    color: #54aeff;
  }

  .file-name {
    color: #cccccc;
  }

  .file-icon {
    color: #54aeff;
  }
}
</style>
