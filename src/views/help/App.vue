<template>
  <div class="help-container">
    <!-- Help Options -->
    <div class="help-options">
        <!-- Report a Bug -->
        <div class="help-item" @click="reportBug">
          <div class="help-icon bug-icon">
            <svg class="icon" aria-hidden="true">
              <use xlink:href="#icon-bug"></use>
            </svg>
          </div>
          <div class="help-content">
            <div class="help-title">Report a Bug</div>
            <div class="help-description">
              Found an issue? Let us know on GitHub
            </div>
          </div>
          <div class="help-arrow">
            <vscode-icon name="chevron-right" size="16"></vscode-icon>
          </div>
        </div>

        <!-- Make the most of Zast Express -->
        <div class="help-item" @click="getHelp">
          <div class="help-icon help-icon">
            <svg class="icon" aria-hidden="true">
              <use xlink:href="#icon-wendang"></use>
            </svg>
          </div>
          <div class="help-content">
            <div class="help-title">Make the most of Zast Express</div>
            <div class="help-description">
              Learn how to use all features effectively
            </div>
          </div>
          <div class="help-arrow">
            <vscode-icon name="chevron-right" size="16"></vscode-icon>
          </div>
        </div>

        <!-- Email Support -->
        <div class="help-item" @click="emailSupport">
          <div class="help-icon email-icon">
            <svg class="icon" aria-hidden="true">
              <use xlink:href="#icon-mail"></use>
            </svg>
          </div>
          <div class="help-content">
            <div class="help-title">Email Support</div>
            <div class="help-description">
              Get personalized help from our support team
            </div>
          </div>
          <div class="help-arrow">
            <vscode-icon name="chevron-right" size="16"></vscode-icon>
          </div>
        </div>
    </div>
    
    <!-- Footer Section -->
    <div class="footer-section">
      <div class="footer-title">Zast.ai Security Extension</div>
      <div class="footer-subtitle">Need help? We're here for you!</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { vscodeApi } from '../../utils/index';
import { allComponents, provideVSCodeDesignSystem } from '@vscode/webview-ui-toolkit';
import '../../fonts/iconfont.js'

provideVSCodeDesignSystem().register(allComponents);

// Reactive state
const config = ref({
  reportUrl: '',
  helpUrl: '',
  supportEmail: ''
});

// Event handlers
const reportBug = () => {
  vscodeApi.post('reportBug', {
    type: 'reportBug'
  });
};

const getHelp = () => {
  vscodeApi.post('getHelp', {
    type: 'getHelp'
  });
};

const emailSupport = () => {
  vscodeApi.post('emailSupport', {
    type: 'emailSupport'
  });
};

// Listen for configuration updates from extension
vscodeApi.on('updateConfig', (data: { reportUrl: string, helpUrl: string, supportEmail: string }) => {
  console.log('Received config update:', data);
  config.value = { ...data };
});

// Lifecycle hooks
onMounted(() => {
  console.log('Help view mounted');
});
</script>

<style scoped>
.icon {
  width: 1.2em;
  height: 1.2em;
  vertical-align: -0.15em;
  fill: currentColor;
  overflow: hidden;
}

.help-container {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  font-weight: var(--vscode-font-weight);
  color: var(--vscode-foreground);
  background-color: var(--vscode-sideBar-background);
  padding: 8px;
  margin: 0;
}

.help-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.help-item {
  display: flex;
  align-items: center;
  padding: 14px 12px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  gap: 12px;
}

.help-item:hover {
  background: var(--vscode-list-hoverBackground);
  border-color: var(--vscode-focusBorder);
}

.help-item:active {
  transform: translateY(1px);
}

.help-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bug-icon {
  color: #e74c3c; /* Red color for bug reports */
}

.help-icon {
  color: #3498db; /* Blue color for help/documentation */
}

.email-icon {
  color: #27ae60; /* Green color for email support */
}

.help-content {
  flex: 1;
  min-width: 0;
}

.help-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--vscode-foreground);
  margin-bottom: 4px;
}

.help-description {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.3;
}

.help-arrow {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vscode-descriptionForeground);
  opacity: 0.7;
  transition: opacity 0.2s ease;
}

.help-item:hover .help-arrow {
  opacity: 1;
}

.footer-section {
  margin-top: 24px;
  padding: 16px;
  text-align: center;
  color: var(--vscode-editorHint-foreground);
  font-size: 12px;
}
</style>
