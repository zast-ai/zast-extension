<template>
  <div class="start-container">
    <div class="layout-grid">
      <!-- Left Panel -->
      <div class="main-header">
        <h1 class="main-title">Meet ZAST Express, Your Reliable Security Partner</h1>
        <p class="main-description">
          ZAST Express secures with expert precision - every vulnerability verified with PoC, zero false positive
          guaranteed. Here are 6 ways to put it to work:
        </p>
      </div>
      <div class="main-content">
        <div class="left-panel">
          <div class="content-wrapper">
            <!-- Main Header -->

            <!-- Features List -->
            <div class="features-list">
              <div v-for="feature in FeatureList" :key="feature.id" class="feature-row"
                :class="{ 'selected': isFeatureSelected(feature.id) }" @click="selectFeature(feature.id)">
                <div class="feature-icon">
                  <svg class="icon" aria-hidden="true">
                    <use :xlink:href="`#${feature.icon}`"></use>
                  </svg>
                </div>
                <div class="feature-content">
                  <div class="feature-title">{{ feature.title }}</div>
                  <div class="feature-description">{{ feature.description }}</div>
                  <div class="feature-checkbox-container">
                    <vscode-checkbox class="feature-checkbox"
                      @change="(event) => handleCheckboxChange(event, feature.id)"
                      :checked="isFeatureCompleted(feature.id)" @click.stop></vscode-checkbox>
                    <span class="feature-checkbox-text">I have completed this step</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Mark as Done -->
            <div class="completion-row" @click="markAllCompleted">
              <div class="completion-checkbox">
                <svg :class="{ 'icon': true, 'active': isAllCompleted }" aria-hidden="true">
                  <use :xlink:href="`#icon-double-check`"></use>
                </svg>
              </div>
              <span class="completion-text">Mark as Done</span>
            </div>
          </div>
        </div>
        <div class="right-panel">
          <!-- Top Section - Text Content -->
          <div class="right-top-section">
            <div class="text-content">
              <h2 class="section-headline">{{ selectedFeature?.title }}</h2>
              <p class="section-description">{{ selectedFeature?.description }}</p>
              <div class="gif-container" v-if="selectedFeature?.gif">
                <img :src="baseUrl + selectedFeature.gif" :alt="selectedFeature.id" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="footer-container">
        <vscode-button class="start-button" :disabled="!isAllCompleted" @click="startSecurityAssessment">Start
          Assessment</vscode-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { vscodeApi } from '../../utils/index';
import { allComponents, provideVSCodeDesignSystem } from '@vscode/webview-ui-toolkit';

import '../../fonts/iconfont.js'
import express1 from './images/express1.gif'
import express2 from './images/express2.gif'
import express3 from './images/express3.gif'
import express4 from './images/express4.gif'
import express5 from './images/express5.gif'
import express6 from './images/express6.gif'

provideVSCodeDesignSystem().register(allComponents);

// Feature definition type
interface Feature {
  id: string;
  title: string;
  icon: string;
  description: string;
  gif: string;
}

const FeatureList: Feature[] = [
  {
    id: "auth",
    title: 'Authentication & Login',
    icon: 'icon-icon-test',
    description: 'Access the ZAST Express platform and complete identity verification.',
    gif: express1
  },
  {
    id: "create-task",
    title: 'Create Assessment Task',
    icon: 'icon-task',
    description: 'Launch a new security assessment task.',
    gif: express2
  },
  {
    id: "upload-artifacts",
    title: 'Upload Artifacts',
    icon: 'icon-upload',
    description: 'Select the artifacts to be assessed and upload source code.',
    gif: express3
  },
  {
    id: "configure-tunnel",
    title: 'Configure Tunnel',
    icon: 'icon-network',
    description: 'Set up Cloudflared tunnel to establish secure connection.',
    gif: express4
  },
  {
    id: "configure-test-accounts",
    title: 'Configure Test Accounts',
    icon: 'icon-sub_account',
    description: 'Set up test accounts for target services requiring authentication and save their session for assessment.',
    gif: express5
  },
  {
    id: "review-results",
    title: 'Review Results',
    icon: 'icon-Report',
    description: 'Get detailed vulnerability reports with verified PoC.',
    gif: express6
  }
];

// Reactive state - using Record<string, boolean> for ID-based completion tracking
const completedFeatures = ref<Record<string, boolean>>({});

// Currently selected feature for right panel display
const selectedFeature = ref<Feature | null>(null);

const baseUrl = ref<string>('');

// Initialize completedFeatures with all feature IDs set to false
const initializeFeatures = () => {
  const initialState: Record<string, boolean> = {};
  FeatureList.forEach(feature => {
    initialState[feature.id] = false;
  });
  completedFeatures.value = initialState;

  // Set first feature as default selected
  selectedFeature.value = FeatureList[0] || null;
};

// Computed properties
const completedCount = computed(() => {
  return Object.values(completedFeatures.value).filter(completed => completed).length;
});

const isAllCompleted = computed(() => {
  console.log(completedCount.value, FeatureList.length);
  return completedCount.value === FeatureList.length;
});

// Check if a specific feature is completed
const isFeatureCompleted = (featureId: string): boolean => {
  return completedFeatures.value[featureId] || false;
};

// Check if a specific feature is currently selected
const isFeatureSelected = (featureId: string): boolean => {
  return selectedFeature.value?.id === featureId;
};

// Methods
// Select a feature to display in the right panel
const selectFeature = (featureId: string) => {
  const feature = FeatureList.find(f => f.id === featureId);
  if (feature) {
    selectedFeature.value = feature;
  }
};

// Handle vscode-checkbox change event
const handleCheckboxChange = (event: Event, featureId: string) => {
  completedFeatures.value[featureId] = (event.target as HTMLInputElement).checked || false;
  saveProgress();
};

const saveProgress = () => {
  vscodeApi.post('saveStartProgress', {
    type: 'saveStartProgress',
    completedFeatures: JSON.stringify(completedFeatures.value)
  });
};

const startSecurityAssessment = () => {
  vscodeApi.post('startAssessment', {
    type: 'startAssessment'
  });
};

const markAllCompleted = () => {
  FeatureList.forEach(feature => {
    completedFeatures.value[feature.id] = true;
  });
  saveProgress();
};

// Listen for messages from extension
vscodeApi.on('loadStartProgress', (data: { completedFeatures: Record<string, boolean> | boolean[], baseUrl: string }) => {
  baseUrl.value = process.env.NODE_ENV === 'development' ? '' : data.baseUrl;
  if (data.completedFeatures) {
    // Handle both old (array) and new (object) format for backward compatibility
    if (Array.isArray(data.completedFeatures)) {
      // Convert old array format to new object format
      const converted: Record<string, boolean> = {};
      FeatureList.forEach((feature, index) => {
        converted[feature.id] = data.completedFeatures[index] || false;
      });
      completedFeatures.value = converted;
    } else {
      // New object format
      completedFeatures.value = data.completedFeatures;
    }
  }
});

// Listen for progress updates from system
vscodeApi.on('startProgressUpdate', (data: { completedFeatures: Record<string, boolean> | boolean[] }) => {
  console.log('startProgressUpdate', data);
  if (data.completedFeatures) {
    // Handle both old (array) and new (object) format for backward compatibility
    if (Array.isArray(data.completedFeatures)) {
      // Convert old array format to new object format
      const converted: Record<string, boolean> = {};
      FeatureList.forEach((feature, index) => {
        converted[feature.id] = data.completedFeatures[index] || false;
      });
      completedFeatures.value = converted;
    } else {
      // New object format
      completedFeatures.value = data.completedFeatures;
    }
  }
});

// Lifecycle
onMounted(() => {
  // Initialize features first
  initializeFeatures();

  // Request saved progress
  vscodeApi.post('getStartProgress', {
    type: 'getStartProgress'
  });
});
</script>

<style scoped>
.feature-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background-color: var(--vscode-list-inactiveSelectionBackground);
  border-radius: 50%;
}

.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  fill: currentColor;
}

.icon.active {
  color: var(--vscode-charts-green);
}

.start-container {
  font-family: var(--vscode-font-family);
  background-color: var(--vscode-editor-background);
  color: var(--vscode-foreground);
  overflow: hidden;
}

.layout-grid {
  box-sizing: border-box;
  padding: 40px 0;
  display: flex;
  flex-direction: column;
  width: 80%;
  margin: 0 auto;
}

/* Left Panel */
.left-panel {
  flex: 1;
  display: flex;
  justify-content: center;
  background-color: var(--vscode-editor-background);
  overflow-y: auto;
}

.content-wrapper {
  max-width: 520px;
  height: 100%;
  display: flex;
  flex-direction: column;
  width: 100%;
}

.main-header {
  margin-bottom: 20px;
}

.main-content {
  display: flex;
  flex-direction: row;
}

.main-title {
  font-size: 21px;
  font-weight: 400;
  line-height: 1.15;
  margin: 0 0 12px 0;
  color: var(--vscode-foreground);
}

.main-description {
  font-size: 14px;
  line-height: 1.5;
  color: var(--vscode-editorInlayHint-foreground);
  margin: 0;
}

/* Features */
.features-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.feature-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 16px;
  cursor: pointer;
  border-radius: 8px;
  transition: background-color 0.2s ease;
  margin: 0 -16px;
}

.feature-row:hover {
  background-color: var(--vscode-list-hoverBackground);
}

.feature-row.selected {
  background-color: var(--vscode-list-activeSelectionBackground);
  border: 1px solid var(--vscode-focusBorder);
}

.feature-row.selected .feature-title {
  color: var(--vscode-list-activeSelectionForeground);
}

.feature-row.selected .feature-description {
  color: var(--vscode-list-activeSelectionForeground);
}

.feature-row.selected .feature-checkbox-text {
  color: var(--vscode-list-activeSelectionForeground);
}

.feature-checkbox {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin-top: 2px;
}

.circle-outline {
  width: 20px;
  height: 20px;
  border: 2px solid #007ACC;
  border-radius: 50%;
  background-color: transparent;
}

.feature-content {
  flex: 1;
  min-width: 0;
}

.feature-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--vscode-editorInlayHint-foreground);
  margin-bottom: 6px;
  line-height: 1.3;
}

.feature-description {
  font-size: 12px;
  color: var(--vscode-editorInlayHint-foreground);
  line-height: 1.4;
  margin: 0;
  margin-bottom: 6px;
}

.feature-checkbox-container {
  display: flex;
  align-items: center;
  gap: 8px;
}

.feature-checkbox-text {
  font-size: 12px;
  color: var(--vscode-editorInlayHint-foreground);
}

/* Completion */
.completion-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  margin: 0 -16px 0 -16px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.completion-row:hover {
  background-color: var(--vscode-list-inactiveSelectionBackground);
}

.completion-checkbox {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

.completion-text {
  font-size: 14px;
  color: var(--vscode-descriptionForeground);
}

/* Right Panel */
.right-panel {
  flex: 1;
  display: grid;
  grid-template-rows: auto 1fr;
}

.section-headline {
  font-size: 16px;
  font-weight: 500;
  line-height: 1.3;
  margin: 0;
  color: var(--vscode-foreground);
}

.section-description {
  font-size: 14px;
  line-height: 1.5;
  color: var(--vscode-editorInlayHint-foreground);
  margin: 0 0 20px 0;
}

.section-details {
  font-size: 14px;
  line-height: 1.5;
  color: var(--vscode-descriptionForeground);
  margin: 0;
}

.right-bottom-section {
  position: relative;
  overflow: hidden;
}

.demo-viewport {
  width: 100%;
  height: 100%;
  position: relative;
}

.demo-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.placeholder-content {
  text-align: center;
  color: var(--vscode-descriptionForeground);
  opacity: 0.5;
}

.placeholder-text {
  font-size: 16px;
  margin: 16px 0 8px 0;
  font-weight: 500;
}

.placeholder-hint {
  font-size: 12px;
  opacity: 0.8;
}

.gif-container {
  width: 100%;
  height: 100%;
  display: flex;
  border: 1px solid var(--vscode-widget-shadow);
  box-shadow: 0 4px 6px var(--vscode-widget-shadow);
  border-radius: 4px;
  padding: 12px;
}

.gif-container img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.footer-container {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px;
}

.start-button {
  width: 220px;
  height: 36px;
}
</style>
