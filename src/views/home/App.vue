<template>
<div class="home-container">
  <!-- Welcome Section -->
  <div v-if="!welcomeDismissed && !isAuthenticated" class="welcome-section">
    <vscode-button class="close-button" @click="dismissWelcome" title="Dismiss" appearance="icon">
      <svg class="icon" aria-hidden="true">
        <use xlink:href="#icon-close"></use>
      </svg>
    </vscode-button>
    <div class="welcome-title">Welcome to the {{ title }}</div>
    <p class="welcome-text">
      AI agent that can analyze code logic, identify vulnerabilities, create POCs, and verify exploitability with zero
      false positives, contributing to the global effort of making software more secure.
    </p>
    <vscode-link @click="openZastWebsite">Learn more</vscode-link>
  </div>

  <!-- Assess Status Section -->
  <div class="section" v-if="isAuthenticated">
    <div class="section-title">Latest Assessment</div>
    <div class="status-box">
      <div class="status-item">
        <span class="status-label">project:</span>
        <span class="status-value">{{ projectName }}</span>
      </div>
      <div class="status-item">
        <span class="status-label">last assess:</span>
        <span class="status-value">{{ lastAssessTime }}</span>
      </div>
      <div class="status-item" v-if="taskStatus">
        <span class="status-label">status:</span>
        <span class="status-value status-badge" :class="`status-${taskStatus.toLowerCase()}`">{{ taskStatus }}</span>
      </div>
    </div>
  </div>

  <!-- Subscription Section -->
  <div class="section" v-if="isAuthenticated">
    <div class="section-title">Subscription</div>
    <div class="subscription-card">
      <div class="subscription-header">
        <div class="plan-badge">{{ planDisplayName }}</div>
        <vscode-button class="subscription-refresh-button" @click="handleRefreshSubscriptionStatus"
          :disabled="subscriptionLoading" appearance="icon" title="Refresh subscription status">
          <svg class="icon icon-refresh" aria-hidden="true">
            <use xlink:href="#icon-refresh"></use>
          </svg>
        </vscode-button>
      </div>

      <div class="subscription-stats">
        <div class="stat-item">
          <span class="stat-label">credits:</span>
          <span class="stat-value">{{ subscriptionStatus.creditsUsage }}/{{ getCreditsDisplay() }}</span>
        </div>
        <!-- <div class="stat-item">
            <span class="stat-label">per month:</span>
            <span class="stat-value">{{ getMonthlyLimitDisplay() }}</span>
          </div> -->
      </div>

      <div class="usage-progress">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${getUsagePercentage()}%` }"
            :class="{ 'progress-exceeded': subscriptionStatus.exceedCreditLimit }"></div>
        </div>
      </div>

      <vscode-button v-if="canUpgrade" class="upgrade-button" @click="upgradeSubscription('pro')"
        :disabled="upgradeLoading" appearance="primary">
        <div class="upgrade-content">
          <span v-if="!upgradeLoading">Upgrade to Pro</span>
          <span v-else class="loading-content">
            <span class="loading-spinner">⟳</span>
            Processing Payment...
          </span>
        </div>
      </vscode-button>

      <vscode-button v-if="hasActiveSubscription" class="manage-button" @click="manageSubscription"
        appearance="secondary">
        Manage Subscription
      </vscode-button>

      <div class="subscription-description">
        <span v-if="!hasActiveSubscription">
          Get unlimited assessments & advanced features
        </span>
        <span v-else>
          Thank you for being a {{ subscriptionStatus.category }} subscriber!
        </span>
      </div>
    </div>
  </div>

  <!-- Tunnel Info Section -->
  <div class="section" v-if="tunnelList.length > 0">
    <div class="section-title">
      <span>Active Tunnel</span>
      <vscode-button v-if="tunnelList[0] && tunnelList[0].port" class="tunnel-stop-button"
        @click="stopTunnel(tunnelList[0].port)" appearance="secondary" title="Stop tunnel">
        Stop
      </vscode-button>
    </div>
    <div class="tunnel-container">
      <div v-for="tunnel in tunnelList" :key="tunnel.port" class="tunnel-item">
        <div class="tunnel-info">
          <div class="tunnel-port">
            <span class="tunnel-label">Port:</span>
            <span class="tunnel-value">{{ tunnel.port }}</span>
          </div>
          <div class="tunnel-url">
            <span class="tunnel-label">URL:</span>
            <span class="tunnel-link" @click="openTunnelUrl(tunnel.url)">{{ tunnel.url }}</span>
          </div>
        </div>

      </div>
    </div>
  </div>

  <!-- Assess Section -->
  <div class="section">
    <div class="section-title">Security Assess</div>
    <vscode-button class="assess-button" :disabled="!isAuthenticated" @click="startNewAssess" appearance="primary">
      Start New Assessment
    </vscode-button>
    <div class="auth-status">
      <div class="auth-indicator" :class="{ 'authenticated': isAuthenticated, 'not-authenticated': !isAuthenticated }">
      </div>
      <span>{{ authStatusText }}</span>
    </div>
    <div class="user-info" v-if="userInfoStr">{{ userInfoStr }}</div>
    <div class="auth-actions">
      <vscode-button v-if="!isAuthenticated" class="auth-button" @click="login" appearance="secondary">
        Login
      </vscode-button>
      <vscode-button v-else class="auth-button" @click="logout" appearance="secondary">
        Logout
      </vscode-button>
    </div>
  </div>
</div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import '../../fonts/iconfont.js'
import { vscodeApi } from '../../utils/index';
import { allComponents, provideVSCodeDesignSystem } from '@vscode/webview-ui-toolkit';

provideVSCodeDesignSystem().register(allComponents);

// Reactive state
const welcomeDismissed = ref(false);
const lastAssessTime = ref('Loading...');
const isAuthenticated = ref(false);
const authStatusText = ref('Checking authentication...');
const projectName = ref('Loading...');
const tunnelList = ref<Array<{ port: number; url: string }>>([]);
const taskStatus = ref('--');
const title = ref(import.meta.env.VITE_TITLE);
// User info state
const userInfo = ref<{ id: string; email: string; name: string } | null>(null);

// Subscription state
const subscriptionStatus = ref({
  category: 'none' as string,
  exceedCreditLimit: false,
  creditsUsage: 0,
  firstTierLimit: 0,
  activeSubscriptionId: undefined as string | undefined
});

const subscriptionLoading = ref(false);
const upgradeLoading = ref(false);
const upgradeTimeout = ref<NodeJS.Timeout | null>(null);

// Computed properties for subscription
const planDisplayName = computed(() => {
  switch (subscriptionStatus.value.category) {
    case 'pro':
      return 'Pro Plan';
    case 'enterprise':
      return 'Enterprise Plan';
    default:
      return 'Free Plan';
  }
});

const userInfoStr = computed(() => {
  if (userInfo.value) {
    return userInfo.value.email ? `${userInfo.value.name || 'N/A'} <${userInfo.value.email}>` : userInfo.value.name;
  }
  return '';
});

const canUpgrade = computed(() => {
  console.log('Current subscription category:', subscriptionStatus.value);
  return subscriptionStatus.value.category === 'none' || subscriptionStatus.value.category === 'trial';
});

const hasActiveSubscription = computed(() => {
  return subscriptionStatus.value.category === 'pro' || subscriptionStatus.value.category === 'enterprise';
});

// Event handlers
const dismissWelcome = () => {
  welcomeDismissed.value = true;
};

const startNewAssess = () => {
  vscodeApi.post('newAssess', {
    type: 'newAssess'
  });
};

const refreshStatus = () => {
  vscodeApi.post('refreshStatus', {
    type: 'refreshStatus'
  });
};

const stopTunnel = (port: number) => {
  vscodeApi.post('stopTunnel', {
    type: 'stopTunnel',
    port: port
  });
};

const refreshTunnelInfo = () => {
  vscodeApi.post('refreshTunnelInfo', {
    type: 'refreshTunnelInfo'
  });
};

const openTunnelUrl = (url: string) => {
  vscodeApi.post('openTunnelUrl', {
    type: 'openTunnelUrl',
    url: url
  });
};

const openZastWebsite = () => {
  vscodeApi.post('openZastWebsite', {
    type: 'openZastWebsite'
  });
};

const login = () => {
  vscodeApi.post('login', {
    type: 'login'
  });
};

const logout = () => {
  vscodeApi.post('logout', {
    type: 'logout'
  });
};

// Subscription methods
const upgradeSubscription = (category: 'pro' | 'enterprise') => {
  if (upgradeLoading.value) return;

  try {
    upgradeLoading.value = true;

    // Clear any existing timeout
    if (upgradeTimeout.value) {
      clearTimeout(upgradeTimeout.value);
      upgradeTimeout.value = null;
    }

    // Set timeout to reset loading state after 5 minutes (in case user closes payment page)
    upgradeTimeout.value = setTimeout(() => {
      upgradeLoading.value = false;
      upgradeTimeout.value = null;
    }, 5 * 60 * 1000); // 5 minutes

    vscodeApi.post('upgradeSubscription', {
      type: 'upgradeSubscription',
      data: { category }
    });
  } catch (error) {
    upgradeLoading.value = false;
    if (upgradeTimeout.value) {
      clearTimeout(upgradeTimeout.value);
      upgradeTimeout.value = null;
    }
    console.error('Failed to start upgrade process:', error);
  }
};

const manageSubscription = () => {
  vscodeApi.post('manageSubscription', {
    type: 'manageSubscription'
  });
};

const refreshSubscriptionStatus = () => {
  vscodeApi.post('refreshSubscriptionStatus', {
    type: 'refreshSubscriptionStatus'
  });
};

// Handle refresh with loading state
const handleRefreshSubscriptionStatus = async () => {
  if (subscriptionLoading.value) return;

  try {
    subscriptionLoading.value = true;
    refreshSubscriptionStatus();

    // Set a minimum loading time for better UX
    setTimeout(() => {
      subscriptionLoading.value = false;
    }, 1000);
  } catch (error) {
    subscriptionLoading.value = false;
    console.error('Failed to refresh subscription status:', error);
  }
};

// Helper function to clear upgrade loading state
const clearUpgradeLoading = () => {
  upgradeLoading.value = false;
  if (upgradeTimeout.value) {
    clearTimeout(upgradeTimeout.value);
    upgradeTimeout.value = null;
  }
};

// Subscription utility methods
const getCreditsDisplay = () => {
  if (['pro', 'enterprise', 'plus'].includes(subscriptionStatus.value.category)) {
    return subscriptionStatus.value.firstTierLimit.toString();
  }
  return '0'; // Default free tier limit
};

const getUsagePercentage = () => {
  if (subscriptionStatus.value.category === 'enterprise') {
    return 0; // Unlimited plans show no progress
  }

  const limit = subscriptionStatus.value.firstTierLimit || 3; // Default to 3 for free tier
  const usage = subscriptionStatus.value.creditsUsage;

  if (usage >= limit) {
    return 100;
  }

  return Math.min((usage / limit) * 100, 100);
};


// Listen for messages from extension
vscodeApi.on('updateStatus', (data: { lastAssess: string, isAuthenticated: boolean, projectName: string, taskStatus: string }) => {
  // Update last assess time
  lastAssessTime.value = data.lastAssess;

  // Update auth status
  isAuthenticated.value = data.isAuthenticated;

  // Update auth status text with user info if available
  if (data.isAuthenticated) {
    authStatusText.value = 'Authenticated';
  } else {
    authStatusText.value = 'Not authenticated';
  }

  projectName.value = data.projectName;
  taskStatus.value = data.taskStatus;
});

// Listen for tunnel info updates
vscodeApi.on('updateTunnelInfo', (data: { tunnelList: Array<{ port: number; url: string }>, timestamp: number }) => {
  console.log('Received updateTunnelInfo:', data);
  tunnelList.value = data.tunnelList;
});

// Listen for authentication status changes
vscodeApi.on('authStatusChanged', (data: { isAuthenticated: boolean, provider?: string, message?: string }) => {
  console.log('Received authStatusChanged:', data);

  // Update authentication status
  isAuthenticated.value = data.isAuthenticated;

  // Update auth status text with user info if available
  if (data.isAuthenticated) {
    authStatusText.value = 'Authenticated';
  } else {
    authStatusText.value = 'Not authenticated';
  }


  // Request status update to sync with backend
  setTimeout(() => {
    refreshStatus();
  }, 100);
});

// Listen for auth feature disable events
vscodeApi.on('disableAuthFeatures', (data: { message?: string }) => {
  console.log('Received disableAuthFeatures:', data);

  // Update UI to reflect disabled state
  isAuthenticated.value = false;
  authStatusText.value = 'Authentication required';
});

// Listen for auth feature enable events
vscodeApi.on('enableAuthFeatures', (data: { message?: string }) => {
  console.log('Received enableAuthFeatures:', data);

  // Update UI to reflect enabled state
  isAuthenticated.value = true;

  // Update auth status text with user info if available
  authStatusText.value = 'Authenticated';

  // Request status update to get latest data
  setTimeout(() => {
    refreshStatus();
  }, 100);
});

// Listen for user info updates
vscodeApi.on('updateUserInfo', (data: { userInfo: { id: string; email: string; name: string } | null, error?: string }) => {
  console.log('Received updateUserInfo:', data);

  // Update user info
  userInfo.value = data.userInfo;

  // Update auth status text with user info if authenticated
  if (isAuthenticated.value) {
    authStatusText.value = `Authenticated`;
  } else if (isAuthenticated.value) {
    authStatusText.value = 'Authenticated';
  }

  // Handle error if present
  if (data.error) {
    console.error('Error receiving user info:', data.error);
  }
});

// Listen for subscription status updates
vscodeApi.on('updateSubscriptionStatus', (data: {
  category: string,
  exceedCreditLimit: boolean,
  creditsUsage: number,
  firstTierLimit: number,
  activeSubscriptionId?: string
}) => {
  console.log('Received updateSubscriptionStatus:', data);
  subscriptionStatus.value = {
    category: data.category,
    exceedCreditLimit: data.exceedCreditLimit,
    creditsUsage: data.creditsUsage,
    firstTierLimit: data.firstTierLimit,
    activeSubscriptionId: data.activeSubscriptionId
  };
  // Reset loading state when update is received
  subscriptionLoading.value = false;
});

// Listen for subscription status changes
vscodeApi.on('subscriptionStatusChanged', (data: { category: string, message?: string }) => {
  console.log('Received subscriptionStatusChanged:', data);

  // Update subscription status
  if (subscriptionStatus.value.category !== data.category) {
    subscriptionStatus.value.category = data.category;
  }

  // Reset loading state
  subscriptionLoading.value = false;
});

// Listen for subscription credit limit exceeded
vscodeApi.on('subscriptionCreditLimitExceeded', (data: { message?: string, creditsUsage: number, firstTierLimit: number }) => {
  console.log('Received subscriptionCreditLimitExceeded:', data);

  // Update subscription status
  subscriptionStatus.value.exceedCreditLimit = true;
  subscriptionStatus.value.creditsUsage = data.creditsUsage;
  subscriptionStatus.value.firstTierLimit = data.firstTierLimit;

  // Reset loading state
  subscriptionLoading.value = false;
});

// Listen for subscription errors
vscodeApi.on('subscriptionError', (data: { message?: string, errorCode?: number }) => {
  console.log('Received subscriptionError:', data);

  // Reset loading state
  subscriptionLoading.value = false;
});

// Listen for global upgrade subscription requests
vscodeApi.on('upgradeSubscription', (data: { category: 'pro' | 'enterprise' }) => {
  console.log('Received global upgradeSubscription request:', data);

  // Trigger upgrade with the specified category
  upgradeSubscription(data.category || 'pro');
});

// Listen for focus subscription section requests
vscodeApi.on('focusSubscriptionSection', (data: { focus: boolean }) => {
  console.log('Received focusSubscriptionSection request:', data);

  if (data.focus) {
    // Scroll to subscription section or highlight it
    const subscriptionSection = document.querySelector('.subscription-card');
    if (subscriptionSection) {
      subscriptionSection.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });

      // Add a temporary highlight effect
      subscriptionSection.classList.add('subscription-focused');
      setTimeout(() => {
        subscriptionSection.classList.remove('subscription-focused');
      }, 3000);
    }
  }
});

// Listen for payment success events
vscodeApi.on('paymentSuccess', (data: { sessionId?: string, message?: string, timestamp?: number }) => {
  console.log('Received paymentSuccess:', data);

  // Clear upgrade loading state
  clearUpgradeLoading();

  // Refresh subscription status to get updated data
  setTimeout(() => {
    refreshSubscriptionStatus();
    // Also refresh user info as payment may affect user status
    vscodeApi.post('getUserInfo', {
      type: 'getUserInfo'
    });
  }, 1000);
});

// Listen for payment cancelled events
vscodeApi.on('paymentCancelled', (data: { sessionId?: string, message?: string, timestamp?: number }) => {
  console.log('Received paymentCancelled:', data);

  // Clear upgrade loading state
  clearUpgradeLoading();

});

// Lifecycle hooks
onMounted(() => {
  // Request initial status update
  refreshStatus();
  // Request initial tunnel info
  refreshTunnelInfo();
  // Request initial subscription status
  refreshSubscriptionStatus();
  // Request user info
  vscodeApi.post('getUserInfo', {
    type: 'getUserInfo'
  });
});

onUnmounted(() => {
  // Clear upgrade timeout when component is unmounted
  if (upgradeTimeout.value) {
    clearTimeout(upgradeTimeout.value);
    upgradeTimeout.value = null;
  }
});
</script>

<style scoped>
.upgrade-content {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  width: 100%;
}

.icon {
  width: 1em;
  height: 1em;
  vertical-align: -0.15em;
  fill: currentColor;
  overflow: hidden;
}

.home-container {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  font-weight: var(--vscode-font-weight);
  color: var(--vscode-foreground);
  background-color: var(--vscode-sideBar-background);
  padding: 16px;
  margin: 0;
}

.welcome-section {
  position: relative;
  background: var(--vscode-input-background);
  box-shadow: 0 2px 4px var(--vscode-widget-shadow);
  border-radius: 4px;
  padding: 18px 12px;
  margin-bottom: 16px;
}

.close-button {
  position: absolute;
  top: 4px;
  right: 8px;
  font-size: 24px;
  cursor: pointer;
  background: var(--vscode-input-background);
}

.welcome-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground);
  padding-right: 20px;
}

.welcome-text {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.4;
  margin: 12px 0;
}

.section {
  margin-bottom: 20px;
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 12px;
  color: var(--vscode-foreground);
}

.status-box {
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  gap: 4px;

  &:not(:last-child) {
    margin-bottom: 8px;
  }
}

.status-label {
  color: var(--vscode-descriptionForeground);
}

.status-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vscode-foreground);
  font-weight: bold;
}

.status-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
}

.tunnel-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tunnel-item {
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  padding: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.tunnel-info {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tunnel-port,
.tunnel-url {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  justify-content: space-between;
}

.tunnel-label {
  color: var(--vscode-descriptionForeground);
  font-weight: 500;
  min-width: 40px;
}

.tunnel-value {
  color: var(--vscode-foreground);
  font-weight: bold;
}

.tunnel-link {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  cursor: pointer;
  color: var(--vscode-textLink-foreground);
  text-decoration: none;
  word-break: break-all;
}

.tunnel-link:hover {
  text-decoration: underline;
}

.tunnel-stop-button {
  flex-shrink: 0;
  font-size: 12px;
  --border-width: 0;
}

.assess-button {
  width: 100%;
  font-weight: bold;
  font-size: 13px;
  padding: 4px 0;
  border-radius: 6px;
  --border-width: 0;
}

.auth-status {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  margin: 12px 0;
}

.auth-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.auth-indicator.authenticated {
  background: var(--vscode-testing-iconPassed);
}

.auth-indicator.not-authenticated {
  background: var(--vscode-testing-iconFailed);
}

.user-info {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  margin: -6px 0 12px 14px;
}

.auth-button {
  width: 100%;
  padding: 4px 0;
  border-radius: 6px;
  font-size: 12px;
  --border-width: 0;
}


.status-success {
  background: var(--vscode-charts-green);
  color: var(--vscode-editor-background);
}

.status-progress {
  background: var(--vscode-charts-blue);
  color: var(--vscode-editor-background);
}

.status-error {
  background: var(--vscode-charts-red);
  color: var(--vscode-editor-background);
}

.status-created {
  background: var(--vscode-charts-orange);
  color: var(--vscode-editor-background);
}

.status-default {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

@keyframes slideIn {
  from {
    transform: translateY(-10px);
    opacity: 0;
  }

  to {
    transform: translateY(0);
    opacity: 1;
  }
}

/* Subscription Styles */
.subscription-card {
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  transition: all 0.3s ease;
}

.subscription-card.subscription-focused {
  box-shadow: 0 0 12px rgba(0, 123, 255, 0.4);
  border-color: var(--vscode-focusBorder);
  transform: scale(1.02);
}

.subscription-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.plan-badge {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  text-transform: capitalize;
}

.subscription-stats {
  margin-bottom: 12px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  margin-bottom: 6px;
}

.stat-label {
  color: var(--vscode-descriptionForeground);
  font-weight: 500;
}

.stat-value {
  color: var(--vscode-foreground);
  font-weight: 600;
}

.usage-progress {
  margin-bottom: 16px;
}

.progress-bar {
  width: 100%;
  height: 6px;
  background-color: var(--vscode-scrollbarSlider-background);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: var(--vscode-charts-blue);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-fill.progress-exceeded {
  background-color: var(--vscode-charts-red);
}

.upgrade-button {
  width: 100%;
  font-weight: bold;
  font-size: 13px;
  padding: 4px 0;
  border-radius: 6px;
  margin-bottom: 8px;
  --border-width: 0;
}

.manage-button {
  width: 100%;
  font-size: 12px;
  padding: 4px 0;
  border-radius: 6px;
  margin-bottom: 8px;
  --border-width: 0;
}

.icon-refresh {
  width: 1.2em;
  height: 1.2em;
  vertical-align: -0.15em;
  fill: currentColor;
  overflow: hidden;
}

.loading-spinner {
  display: inline-block;
  font-size: 1.2em;
  animation: rotate-continuous 1s linear infinite;
}

.loading-content {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}

.subscription-description {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  text-align: center;
  line-height: 1.4;
  margin-top: 8px;
}

.subscription-refresh-button {
  flex-shrink: 0;
  font-size: 12px;
  --border-width: 0;
}

.subscription-refresh-button:hover .icon:not(.rotating) {
  animation: rotate 0.6s ease-in-out;
}

.subscription-refresh-button .icon.rotating {
  animation: rotate-continuous 1s linear infinite;
}

.subscription-refresh-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@keyframes rotate-continuous {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>

<style>
body {
  overflow: hidden;
  padding: 0;
}

#app {
  height: 100vh;
  overflow: auto;
}
</style>
