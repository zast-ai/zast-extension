<template>
  <div class="session-container">
    <!-- Browser Title -->
    <div class="browser-header">
      <h3 class="browser-header-title">Test Account</h3>
      <div v-if="isBrowserUrlEmpty" class="status-indicator">
        <span class="status-text">Remote Browser Unavailable</span>
      </div>
      <div v-else-if="isServiceUrlEmpty" class="status-indicator">
        <span class="status-text">Service Unavailable</span>
      </div>
      <div v-else-if="!props.diagnosticsSuccess" class="status-indicator">
        <span class="status-text">Network Diagnostics Required</span>
      </div>
    </div>
    <p class="browser-header-description">
      Add different test accounts to simulate different user roles and save sessions for each account.
    </p>

    <!-- Browser Iframe -->
    <div class="browser-wrapper" :class="{ disabled: isServiceUnavailable || isBrowserUrlEmpty, unavailable: isBrowserUrlEmpty }">
      <div v-if="isBrowserUrlEmpty" class="unavailable-indicator">
        <div class="unavailable-message">
          <div class="unavailable-icon">⚠️</div>
          <div class="unavailable-text">Remote Browser Unavailable</div>
          <div class="unavailable-description">
            Unable to connect to remote browser service
          </div>
          <vscode-button
            appearance="primary"
            @click="handleRetryBrowserUrl"
            class="retry-button"
          >
            Retry
          </vscode-button>
        </div>
      </div>
      <div v-else-if="isServiceUrlEmpty" class="loading-indicator">
        Service Unavailable
      </div>
      <div v-else-if="!props.diagnosticsSuccess" class="loading-indicator">
        Network Diagnostics Required
      </div>
      <iframe
        v-if="!isBrowserUrlEmpty"
        v-show="props.diagnosticsSuccess && !isServiceUrlEmpty"
        ref="iframe"
        :src="props.browserUrl"
        frameborder="0"
        class="browser-iframe"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>

    <!-- Accounts Section -->
    <div class="accounts-section" :class="{ disabled: isServiceUnavailable || isBrowserUrlEmpty }">
      <!-- Table Header -->
      <div class="accounts-header">
        <div class="header-item">Start URL</div>
        <div class="header-item">Role</div>
        <div class="header-item">Actions</div>
      </div>

      <!-- Account List -->
      <div class="accounts-list">
        <div
          v-for="(account, index) in accounts"
          :key="account.targetId"
          class="account-item"
        >
          <div class="account-row">
            <!-- URL Input -->
            <div class="url-input">
              <vscode-text-field
                :value="account.startUrl"
                readonly
                disabled
                placeholder="https://example.com/login"
              />
            </div>

            <!-- Role Select -->
            <div class="role-select">
              <vscode-dropdown
                :value="account.role"
                @change="(e) => updateAccountRole(index, e.target.value)"
                :disabled="account.saved || isServiceUnavailable || isBrowserUrlEmpty"
              >
                <vscode-option value="">Select Role</vscode-option>
                <vscode-option
                  v-for="option in roleOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </vscode-option>
              </vscode-dropdown>
            </div>

            <!-- Actions -->
            <div class="actions">
              <vscode-button
                :appearance="account.session ? 'primary' : 'secondary'"
                @click="handleSaveSession(account, index)"
                :disabled="saveLoadingIndex === index || isServiceUnavailable || isBrowserUrlEmpty"
              >
                {{ account.session ? '✓ Saved' : 'Save Session' }}
              </vscode-button>
              <vscode-button
                appearance="secondary"
                @click="deleteAccount(account, index)"
                :disabled="isServiceUnavailable || isBrowserUrlEmpty"
                style="margin-left: 8px"
              >
                Delete
              </vscode-button>
            </div>
          </div>
        </div>
      </div>

      <!-- Add Account Button -->
      <div class="add-account">
        <vscode-button
          appearance="primary"
          @click="addAccount"
          :disabled="!canAddNewAccount || addAccountLoading || isServiceUnavailable || isBrowserUrlEmpty"
        >
          + Add Account
        </vscode-button>
        <div v-if="!canAddNewAccount && !isServiceUnavailable && !isBrowserUrlEmpty" class="add-account-tip">
          Please complete the current account setup before adding a new one
        </div>
        <div v-if="isServiceUnavailable || isBrowserUrlEmpty" class="add-account-tip">
          Browser service is not available
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { showAlertDialog, showConfirmDialog } from '../../../utils/index';

// Types
interface Account {
  startUrl: string;
  role: string;
  targetId: string;
  session: any;
  browserContextId: string;
  saved?: boolean;
}

interface RoleOption {
  value: string;
  label: string;
}

// Props definition
const props = defineProps<{
  serviceUrl: string;
  browserUrl: string;
  diagnosticsSuccess: boolean;
}>();

// Emit events to parent
const emit = defineEmits<{
  requestBrowserUrl: [];
  accountsChange: [accounts: any[]];
}>();

// Role options
const roleOptions: RoleOption[] = [
  { label: 'Administrator', value: 'admin' },
  { label: 'Normal User', value: 'normal' },
];

// Reactive state
const accounts = ref<Account[]>([]);
const addAccountLoading = ref(false);
const saveLoadingIndex = ref(-1);
const iframe = ref<HTMLIFrameElement | null>(null);

// Declare the resolve function for iframe loaded promise
let iframeLoadedResolve: (() => void) | null = null;
const iframeLoadedPromise = new Promise<void>((resolve) => {
  iframeLoadedResolve = resolve;
});

// Message handlers for iframe communication
const iframeMessageHandlers = ref<Record<string, (data: any) => void>>({});

// Computed properties for URL states
const isBrowserUrlEmpty = computed(() => !props.browserUrl || props.browserUrl.trim() === '');
const isServiceUrlEmpty = computed(() => !props.serviceUrl || props.serviceUrl.trim() === '');
const isServiceUnavailable = computed(() => isServiceUrlEmpty.value || !props.diagnosticsSuccess);

watch(() => props.serviceUrl, (newServiceUrl, oldServiceUrl) => {
  console.log('newServiceUrl', newServiceUrl, 'oldServiceUrl', oldServiceUrl);

  iframeLoadedPromise.then(() => {
    clearTabs().then(() => {
      initAccounts();
    });
  });
});

// Watch accounts changes and emit to parent
watch(
  accounts,
  (newAccounts) => {
    const sessionAccounts = newAccounts.map((account) => ({
      roleName: account.role,
      loginUrl: account.startUrl,
      originRequestData: account.session,
    })).filter((account) => account.roleName && account.loginUrl && account.originRequestData);
    emit('accountsChange', sessionAccounts);
  },
  { deep: true }
);

// Computed properties
const canAddNewAccount = computed(() => {
  if (isServiceUnavailable.value || isBrowserUrlEmpty.value) return false;
  return accounts.value.length === 0 || accounts.value[accounts.value.length - 1].session;
});

// Methods
const updateAccountRole = (index: number, role: string) => {
  if (isServiceUnavailable.value || isBrowserUrlEmpty.value) return;
  accounts.value[index].role = role;
};

const createDefaultAccount = (): Account => ({
  startUrl: '',
  role: '',
  targetId: Math.random().toString(),
  session: null,
  browserContextId: '',
});

const sendIframeMessage = (type: string, data: any = null): Promise<any> => {
  return new Promise((resolve, reject) => {
    const messageId = Date.now().toString();

    // Store handler for this message
    iframeMessageHandlers.value[messageId] = (response) => {
      if (response.success) {
        resolve(response.data);
      } else {
        reject(response.error || 'Failed to send message to iframe');
      }
      delete iframeMessageHandlers.value[messageId];
    };

    // Send message to iframe
    if (iframe.value?.contentWindow) {
      iframe.value.contentWindow.postMessage(
        {
          type,
          data,
          messageId,
        },
        '*'
      );
    }
  });
};

const handleIframeMessage = (event: MessageEvent) => {
  console.log('handleIframeMessage', event);
  const { type, data, messageId } = event.data;

  if (!type) return;

  if (type === 'iframeLoaded') {
    // Resolve the iframe loaded promise
    if (iframeLoadedResolve) {
      iframeLoadedResolve();
      iframeLoadedResolve = null; // Clear the reference after resolving
    }
    initCopyPaste();
    return;
  }

  if (type === 'updateTabs') {
    initAccounts(data.data);
    return;
  }

  if (messageId && iframeMessageHandlers.value[messageId]) {
    iframeMessageHandlers.value[messageId](data);
  }
};

// const onIframeLoad = () => {
//   // Iframe loaded, can start communication
//   nextTick(() => {
//     initAccounts()
//   });
// };

const initAccounts = async (newTabs?: any[]) => {
  try {
    const tabs = newTabs || (await getTabs());

    if (tabs.length === 0 && !newTabs) {
      await createNewTab(props.serviceUrl || '');
      accounts.value = [createDefaultAccount()];
      return;
    }

    const currentAccounts = accounts.value;
    const updatedAccounts = tabs.map((tab: any) => {
      const currentAccount = currentAccounts.find(acc => acc.targetId === tab.targetId) || createDefaultAccount();
      const tabUrl = ['about:blank'].includes(tab.url) ? '' : tab.url;

      return {
        ...currentAccount,
        startUrl: tabUrl,
        targetId: tab.targetId,
        browserContextId: tab.browserContextId,
      };
    });

    const isDefaultTab = updatedAccounts.every((account) => account.startUrl === '');

    if (isDefaultTab) {
      go(props.serviceUrl);
    }

    accounts.value = updatedAccounts;
  } catch (error) {
    console.error('Error initializing accounts:', error);
  }
};

const addAccount = async () => {
  if (isServiceUnavailable.value || isBrowserUrlEmpty.value) return;
  
  addAccountLoading.value = true;
  try {
    let targetUrl = '';
    if (accounts.value.length > 0) {
      targetUrl = accounts.value[accounts.value.length - 1].startUrl;
    }

    await createNewContextTab(targetUrl);
    
    setTimeout(() => {
      initAccounts();
      addAccountLoading.value = false;
    }, 1000);
  } catch (error) {
    console.error('Error adding account:', error);
    addAccountLoading.value = false;
  }
};

const deleteAccount = async (account: Account, index: number) => {
  if (isServiceUnavailable.value || isBrowserUrlEmpty.value) return;
  
  try {
    // VSCode confirmation dialog
    const confirmed = await showConfirmDialog(
      'Delete Account',
      'Are you sure you want to delete this account?'
    );
    
    if (!confirmed) {
      return;
    }

    if (accounts.value.length === 1) {
      await clearSession(account);
      setTimeout(() => {
        initAccounts();
      }, 1000);
    }

    await closeTab(account.targetId);
    accounts.value.splice(index, 1);
  } catch (error) {
    console.error('Error deleting account:', error);
  }
};

// const clearAccounts = async () => {
//   await Promise.all(
//     accounts.value.map(async (account, index) => {
//       if (index === accounts.value.length - 1) {
//         await clearSession(account);
//       }
//       await closeTab(account.targetId);
//     })
//   );

//   accounts.value = [];
// };

const handleSaveSession = async (account: Account, index: number) => {
  if (isServiceUnavailable.value || isBrowserUrlEmpty.value) return;
  
  try {
    // Validate role is selected
    if (!account.role) {
      console.log('Warning', 'Please select a role before verifying login');
      showAlertDialog('Warning', 'Please select a role before verifying login');
      return;
    }

    // Confirm action
    const roleItem = roleOptions.find(item => item.value === account.role);
    const confirmed = await showConfirmDialog(
      'Confirm Login Verification',
      `Confirm login verification for role: ${roleItem?.label}?`
    );
    
    if (!confirmed) {
      return;
    }

    saveLoadingIndex.value = index;
    
    const { sessionInfo } = await getSession(account.targetId);
    console.log('sessionInfo', sessionInfo);
    
    accounts.value[index] = {
      ...account,
      session: sessionInfo ? {
        ...sessionInfo,
        headers: sessionInfo.headers?.map((header: any) => ({
          url: header.url,
          method: header.method,
          requestHeaders: Object.keys(header.requestHeaders || {}).map((key) => ({
            name: key,
            value: header.requestHeaders[key],
          })),
        })) || [],
      } : null,
    };

    saveLoadingIndex.value = -1;
  } catch (error) {
    console.error('Error saving session:', error);
    saveLoadingIndex.value = -1;
    await showAlertDialog('Error', 'Failed to save session. Please try again.');
  }
};

// Iframe communication methods
const getTabs = () => sendIframeMessage('getTabs');
const createNewTab = (url: string) => sendIframeMessage('newTab', { url });
const createNewContextTab = (url: string) => sendIframeMessage('newContextTab', { url });
const closeTab = (targetId: string) => sendIframeMessage('closeTab', { targetId });
const getSession = (targetId: string) => sendIframeMessage('getSession', { targetId });
const clearSession = (account: Account) => sendIframeMessage('clearSession', { targetId: account.targetId });
const go = (url: string) => sendIframeMessage('go', { url });
const initCopyPaste = () => sendIframeMessage('initCopyPaste');
const clearTabs = () => sendIframeMessage('clearTabs');

// Handle retry button click
const handleRetryBrowserUrl = () => {
  console.log('Requesting new browser URL...');
  emit('requestBrowserUrl');
};

// Initialize component
onMounted(async () => {
  // Listen for iframe messages
  window.addEventListener('message', handleIframeMessage);
});

onUnmounted(() => {
  window.removeEventListener('message', handleIframeMessage);
});
</script>

<style scoped>
.session-container {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 16px;
}

.alert-section {
  margin-bottom: 16px;
}

.alert-info {
  background: var(--vscode-editorInfo-background);
  color: var(--vscode-editorInfo-foreground);
  padding: 12px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.alert-icon {
  font-size: 16px;
}

.alert-warning {
  background: var(--vscode-editorWarning-background);
  color: var(--vscode-editorWarning-foreground);
  padding: 12px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.browser-header {
  /* margin-bottom: 16px; */
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.browser-header-title {
  margin: 0 0 4px 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.browser-header-description {
  margin: 0 0 20px 0;
  font-size: 14px;
  color: var(--vscode-editorHint-foreground);
  line-height: 1.4;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-text {
  color: var(--vscode-errorForeground);
  font-size: 12px;
  font-weight: 500;
}

.browser-wrapper {
  position: relative;
  margin-bottom: 20px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  height: 500px;
}



.browser-wrapper.unavailable {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--vscode-editor-background);
}

.loading-indicator {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 16px;
  color: var(--vscode-foreground);
}

.unavailable-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.unavailable-message {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 32px;
}

.unavailable-icon {
  font-size: 48px;
  opacity: 0.7;
}

.unavailable-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.unavailable-description {
  font-size: 14px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 8px;
}

.retry-button {
  min-width: 120px;
}

.browser-iframe {
  width: 100%;
  height: 100%;
  border: none;
}

.browser-wrapper.disabled {
  opacity: 0.6;
}

.accounts-section {
  margin-bottom: 16px;
  flex: 1;
  min-height: 0;
}

.accounts-section.disabled {
  opacity: 0.6;
  pointer-events: none;
}

.accounts-section h3 {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 600;
}

.accounts-header {
  display: flex;
  padding: 12px 0;
  border-bottom: 1px solid var(--vscode-panel-border);
  margin-bottom: 16px;
  gap: 16px;
}

.header-item {
  font-size: 14px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.header-item:nth-child(1) {
  flex: 2;
}

.header-item:nth-child(2) {
  flex: 1;
}

.header-item:nth-child(3) {
  flex: 1;
}

.accounts-list {
  margin-bottom: 20px;
}

.account-item {
  margin-bottom: 16px;
}

.account-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.url-input {
  flex: 2;
}

.role-select {
  flex: 1;
}

.actions {
  flex: 1;
  display: flex;
  gap: 8px;
}

.add-account {
  margin-top: 20px;
}

.add-account-tip {
  margin-top: 8px;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.accounts-section.disabled .add-account-tip {
  color: var(--vscode-errorForeground);
}

/* VSCode component styling */
vscode-text-field {
  width: 100%;
}

vscode-dropdown {
  width: 100%;
}

vscode-button {
  min-width: 100px;
}
</style>
