<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api } from '../../lib/api'
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
    toast(cause instanceof Error ? cause.message : '退出登录失败，请重试', 'error')
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
    aria-label="我的"
  >
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
  padding: 1rem 1rem 1.5rem;
  background: var(--drop-surface-sunken);
}

.me-card {
  border: 1px solid var(--drop-border);
  border-radius: var(--drop-radius-lg);
  background: var(--drop-card);
}

.account {
  padding: 1rem;
  text-align: center;
}
.account-meta {
  font-size: 0.8125rem;
  color: var(--drop-ink-3);
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
  font-size: 0.9375rem;
  font-weight: 500;
  -webkit-tap-highlight-color: transparent;
}
.logout-btn:active {
  background: var(--drop-surface-2);
}
.logout-btn:disabled {
  opacity: 0.6;
}
</style>
