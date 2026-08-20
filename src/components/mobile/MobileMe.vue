<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api, getUserErrorMessage } from '../../lib/api'
import { COPY } from '../../lib/copy'
import { toast } from '../../lib/toast'
import AppIcon from './AppIcon.vue'

const emit = defineEmits<{ logout: [] }>()

const githubUserId = ref<string | null>(null)
const loading = ref(false)
const logoutBusy = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    const me = await api<{ authenticated: boolean; githubUserId: string }>('/api/auth/me')
    githubUserId.value = me.githubUserId
  } catch {
    githubUserId.value = null
  } finally {
    loading.value = false
  }
}

async function logout(): Promise<void> {
  if (logoutBusy.value) return
  logoutBusy.value = true
  try {
    await api<void>('/api/auth/logout', {
      method: 'POST',
      headers: { Origin: window.location.origin },
    })
    emit('logout')
  } catch (cause) {
    toast(getUserErrorMessage(cause, COPY.errors.logout), 'error')
  } finally {
    logoutBusy.value = false
  }
}

onMounted(() => void load())
defineExpose({ load })
</script>

<template>
  <section
    class="mobile-me"
    aria-labelledby="mobile-me-title"
  >
    <h2
      id="mobile-me-title"
      class="sr-only"
    >
      我的账户
    </h2>
    <div class="me-card account">
      <div class="account-meta">
        通过 GitHub 登录{{ githubUserId ? ` · ID ${githubUserId}` : '' }}
      </div>
    </div>

    <div class="me-card logout-card">
      <button
        type="button"
        class="logout-btn"
        :disabled="logoutBusy"
        @click="logout"
      >
        <AppIcon name="log-out" />
        <span>{{ logoutBusy ? '退出中…' : '退出登录' }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.mobile-me {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem var(--drop-mobile-gutter) 1.5rem;
  background: var(--drop-surface-sunken);
}

.me-card {
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: var(--drop-card);
  box-shadow: var(--drop-shadow-1);
}

.account {
  padding: 1rem;
  text-align: center;
}
.account-meta {
  font-family: var(--font-micro);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  color: var(--drop-ink-3);
}
.account-meta::before {
  content: "[ ";
  color: var(--drop-brand);
}
.account-meta::after {
  content: " ]";
  color: var(--drop-brand);
}

.logout-card {
  overflow: hidden;
}
.logout-btn {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 3.125rem;
  border: 0;
  background: transparent;
  color: var(--drop-state-error);
  font-family: var(--font-micro);
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  -webkit-tap-highlight-color: transparent;
}
.logout-btn:active {
  background: var(--drop-state-error);
  color: var(--drop-background);
}
.logout-btn:disabled {
  opacity: 0.6;
}
</style>
