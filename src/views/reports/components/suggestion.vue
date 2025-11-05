<template>
<div class="suggestion-container" @click.stop>
  <!-- Vulnerability Principle -->
  <div class="suggestion-section">
    <h3 class="subsection-title">Vulnerability Principle</h3>
    <div class="content" v-html="formatText(props.suggestionInfo.principle)"></div>
  </div>

  <!-- Fix Method -->
  <div class="suggestion-section">
    <h3 class="subsection-title">Fix Method</h3>
    <div class="content" v-html="formatText(props.suggestionInfo.fix_method)"></div>
  </div>

  <!-- Code Example -->
  <div class="suggestion-section" v-if="props.suggestionInfo.code_example">
    <h3 class="subsection-title">Code Example</h3>
    <div class="code-example">
      <div class="code-before">
        <div class="code-header">
          <span class="code-label">Before Fix</span>
        </div>
        <div class="code-block">
          <pre>{{ props.suggestionInfo.code_example.before }}</pre>
        </div>
      </div>

      <div class="code-after">
        <div class="code-header">
          <span class="code-label">After Fix</span>
        </div>
        <div class="code-block">
          <pre>{{ props.suggestionInfo.code_example.after }}</pre>
        </div>
      </div>

      <div class="code-explanation" v-if="props.suggestionInfo.code_example.explanation">
        <div class="explanation-content" v-html="formatText(props.suggestionInfo.code_example.explanation)"></div>
      </div>
    </div>
  </div>

  <!-- Alternative Solutions -->
  <div class="suggestion-section"
    v-if="props.suggestionInfo.alternatives && props.suggestionInfo.alternatives.length > 0">
    <h3 class="subsection-title">Alternative Solutions</h3>
    <div class="alternatives-list">
      <div class="alternative-item" v-for="(alt, index) in props.suggestionInfo.alternatives" :key="index">
        <div class="alternative-title">{{ alt.title }}</div>
        <div class="alternative-description" v-html="formatText(alt.description)"></div>
        <div class="alternative-use-case" v-if="alt.use_case">
          <strong>Use Case:</strong>
          <span v-html="formatText(alt.use_case)"></span>
        </div>
      </div>
    </div>
  </div>

  <!-- Temporary Mitigation -->
  <div class="suggestion-section"
    v-if="props.suggestionInfo.temp_mitigation && props.suggestionInfo.temp_mitigation.length > 0">
    <h3 class="subsection-title">Temporary Mitigation</h3>
    <div class="mitigations-list">
      <div :class="['mitigation-item', getUrgencyClass(mitigation.urgency)]"
        v-for="(mitigation, index) in props.suggestionInfo.temp_mitigation" :key="index">
        <div class="mitigation-header">
          <span class="mitigation-title">{{ mitigation.title }}</span>
        </div>
        <div class="mitigation-description" v-html="formatText(mitigation.description)"></div>
        <span class="urgency-tag" :class="getUrgencyClass(mitigation.urgency)" v-if="mitigation.urgency">
          {{ getUrgencyText(mitigation.urgency) }}
        </span>
      </div>
    </div>
  </div>
</div>
</template>

<script lang="ts" setup>
// Define data interface types
interface Alternative {
  title: string;
  description: string;
  use_case?: string;
}

interface Mitigation {
  title: string;
  description: string;
  urgency?: string;
}

interface Reference {
  type: string;
  title: string;
  url: string;
  description?: string;
}

interface CodeExample {
  before: string;
  after: string;
  explanation?: string;
}

interface SuggestionInfo {
  principle: string;
  fix_method: string;
  alternatives?: Alternative[];
  temp_mitigation?: Mitigation[];
  references?: Reference[];
  confidence: number;
  code_example?: CodeExample;
}

// Define props
interface Props {
  suggestionInfo: SuggestionInfo;
}

const props = defineProps<Props>();

// Format text, convert newlines to br tags
const formatText = (text: string | undefined): string => {
  if (!text) return '';
  return text.replace(/\n/g, '<br>');
};

// Get urgency class name
const getUrgencyClass = (urgency: string | undefined): string => {
  switch (urgency?.toLowerCase()) {
    case 'high': return 'urgency-high';
    case 'medium': return 'urgency-medium';
    case 'low': return 'urgency-low';
    default: return '';
  }
};

// Get urgency text
const getUrgencyText = (urgency: string | undefined): string => {
  switch (urgency?.toLowerCase()) {
    case 'high': return 'High';
    case 'medium': return 'Medium';
    case 'low': return 'Low';
    default: return '';
  }
};

</script>

<style scoped>
.suggestion-container {
  color: var(--vscode-foreground);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  line-height: 1.6;
}

.section-title {
  color: var(--vscode-editor-foreground);
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--vscode-panel-border);
  padding-bottom: 8px;
}

.suggestion-section {
  margin-bottom: 24px;
}

.subsection-title {
  color: var(--vscode-editor-foreground);
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}

.content {
  color: var(--vscode-foreground);
  padding-left: 16px;
}

.code-example {
  display: flex;
  flex-direction: column;
  gap: 16px;
  background-color: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 16px;
}

.code-before,
.code-after {
  flex: 1;
}

.code-header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.code-label {
  font-weight: 600;
  font-size: 14px;
  color: var(--vscode-editor-foreground);
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

.code-explanation {
  margin-top: 12px;
  padding: 12px;
  background-color: var(--vscode-textBlockQuote-background);
  border-left: 3px solid var(--vscode-textLink-foreground);
}

.explanation-content {
  color: var(--vscode-foreground);
}

.alternatives-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mitigations-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.alternative-item {
  padding: 12px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  background-color: var(--vscode-sideBar-background);
}

.mitigation-item {
  padding: 16px;
  background-color: var(--vscode-sideBar-background) !important;
  margin-bottom: 12px;
  border-radius: 4px;
}

.mitigation-item.urgency-high {
  border-left: 4px solid #ff6b6b;
}

.mitigation-item.urgency-medium {
  border-left: 4px solid #ffa726;
}

.mitigation-item.urgency-low {
  border-left: 4px solid #66bb6a;
}

.alternative-title,
.mitigation-title {
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--vscode-editor-foreground);
}

.alternative-description,
.alternative-use-case {
  color: var(--vscode-foreground);
  font-size: 14px;
  padding-left: 16px;
}

.mitigation-description {
  color: var(--vscode-foreground);
  font-size: 14px;
  margin-top: 8px;
  line-height: 1.5;
}

.alternative-use-case strong {
  font-weight: 600;
}

.mitigation-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.urgency-tag {
  display: inline-block;
  margin-top: 16px;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  text-transform: uppercase;
}

.urgency-high {
  background-color: #ff6b6b;
  color: white;
}

.urgency-medium {
  background-color: #ffa726;
  color: white;
}

.urgency-low {
  background-color: #66bb6a;
  color: white;
}

.references-list {
  list-style-type: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.reference-item {
  padding: 12px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  background-color: var(--vscode-sideBar-background);
}

.reference-link {
  display: block;
  text-decoration: none;
  color: var(--vscode-textLink-foreground);
  margin-bottom: 8px;
}

.reference-link:hover {
  text-decoration: underline;
}

.reference-title {
  font-weight: 500;
}

.reference-description {
  color: var(--vscode-foreground);
  padding-left: 16px;
  font-size: 14px;
}
</style>