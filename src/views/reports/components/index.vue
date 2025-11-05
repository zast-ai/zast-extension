<template>
<div class="vulnerability-display">
  <!-- Tab Navigation -->
  <div class="tab-navigation">
    <button class="tab-button" :class="{ active: activeTab === 'overview' }" @click.stop="handleTabClick('overview')">
      Overview
    </button>
    <button v-if="fixSuggestionContent" class="tab-button" :class="{ active: activeTab === 'fix-suggestion' }"
      @click.stop="handleTabClick('fix-suggestion')">
      Fix Suggestion
    </button>
  </div>

  <!-- Tab Content -->
  <div class="tab-content">
    <!-- Overview Tab -->
    <div v-if="activeTab === 'overview'" class="tab-panel">
      <component :is="vulnerabilityComponent" :issue-detail="issueDetail" :has-source="props.showDataFlow" />
    </div>

    <!-- Fix Suggestion Tab -->
    <div v-if="activeTab === 'fix-suggestion'" class="tab-panel">
      <div class="fix-suggestion-content">
        <suggestion-component :suggestion-info="fixSuggestionContent"></suggestion-component>
      </div>
    </div>
  </div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import CsrfComponent from './csrf.vue';
import IdorComponent from './idor.vue';
import SinkComponent from './sink.vue';
import SuggestionComponent from './suggestion.vue';

interface Props {
  issueDetail: any;
  showDataFlow?: boolean;
}

const props = defineProps<Props>();

// Tab state
const activeTab = ref<'overview' | 'fix-suggestion'>('overview');

const vulnerabilityComponent = computed(() => {
  const category = props.issueDetail.category;
  // const vulId = props.issueDetail.vulId;

  // 根据漏洞类型返回对应组件
  if (category === 'Incorrect Authorization') {
    return IdorComponent;
  }

  if (category === 'Cross Site Request Forgery') {
    return CsrfComponent;
  }

  // if (vulId && vulId.includes('gql')) {
  //   return SinkComponent; // GraphQL 漏洞也使用 SinkComponent
  // }

  // 其他类型使用 SinkComponent
  return SinkComponent;
});

// Fix suggestion content
const fixSuggestionContent = computed(() => {
  const suggestion = props.issueDetail.fixSuggestion;

  try {
    return suggestion ? JSON.parse(suggestion) : null;
  } catch (error) {
    console.error('Error parsing fixSuggestion JSON:', error);
    return null;
  }
});

const handleTabClick = (tab: 'overview' | 'fix-suggestion') => {
  activeTab.value = tab;
};
</script>

<style scoped>
.vulnerability-display {
  width: 100%;
}

/* Tab Navigation */
.tab-navigation {
  display: flex;
  border-bottom: 1px solid var(--vscode-panel-border);
  margin-bottom: 16px;
  background: var(--vscode-editor-background);
}

.tab-button {
  background: transparent;
  border: none;
  padding: 12px 16px;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  transition: all 0.2s ease;
  position: relative;
}

.tab-button:hover {
  color: var(--vscode-foreground);
  background: var(--vscode-list-hoverBackground);
}

.tab-button.active {
  color: var(--vscode-foreground);
  border-bottom-color: var(--vscode-textLink-foreground);
  background: var(--vscode-tab-activeBackground);
}

/* Tab Content */
.tab-content {
  min-height: 200px;
}

.tab-panel {
  animation: fadeIn 0.2s ease-in-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Fix Suggestion Content */
.fix-suggestion-content {}

.markdown-content {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  line-height: 1.6;
  color: var(--vscode-foreground);
}

/* Markdown styling */
.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  color: var(--vscode-foreground);
  margin: 16px 0 8px 0;
  font-weight: 600;
}

.markdown-content :deep(h1) {
  font-size: 1.5em;
}

.markdown-content :deep(h2) {
  font-size: 1.3em;
}

.markdown-content :deep(h3) {
  font-size: 1.2em;
}

.markdown-content :deep(h4) {
  font-size: 1.1em;
}

.markdown-content :deep(p) {
  margin: 8px 0;
  line-height: 1.6;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}

.markdown-content :deep(li) {
  margin: 4px 0;
  line-height: 1.5;
}

.markdown-content :deep(code) {
  background: var(--vscode-textCodeBlock-background);
  color: var(--vscode-textPreformat-foreground);
  padding: 2px 4px;
  border-radius: 3px;
  font-family: var(--vscode-editor-font-family);
  font-size: 0.9em;
}

.markdown-content :deep(pre) {
  background: var(--vscode-textCodeBlock-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 12px;
  overflow-x: auto;
  margin: 12px 0;
}

.markdown-content :deep(pre code) {
  background: transparent;
  padding: 0;
  font-family: var(--vscode-editor-font-family);
  font-size: 12px;
  line-height: 1.4;
  color: var(--vscode-editor-foreground);
}

.markdown-content :deep(blockquote) {
  border-left: 4px solid var(--vscode-textLink-foreground);
  padding-left: 12px;
  margin: 12px 0;
  color: var(--vscode-descriptionForeground);
  font-style: italic;
}

.markdown-content :deep(strong) {
  font-weight: 600;
  color: var(--vscode-foreground);
}

.markdown-content :deep(em) {
  font-style: italic;
}

.markdown-content :deep(a) {
  color: var(--vscode-textLink-foreground);
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

/* No suggestion state */
.no-suggestion {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--vscode-descriptionForeground);
  text-align: center;
  gap: 8px;
}

.no-suggestion-icon {
  font-size: 32px;
  opacity: 0.6;
}
</style>
