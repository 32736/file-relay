<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { api } from '../../lib/api'
import { formatBytes } from '../../lib/format'
import { toast } from '../../lib/toast'
import ShareDialog from '../ShareDialog.vue'
import type { FileItem } from '../FileList.vue'
import AppIcon from './AppIcon.vue'
import MobileActionSheet from './MobileActionSheet.vue'
import MobileFiles from './MobileFiles.vue'
import MobileMe from './MobileMe.vue'
import MobileShareDetail from './MobileShareDetail.vue'
import MobileShares from './MobileShares.vue'
import type { MobileShareItem } from './MobileShares.vue'
import MobileUploadSheet from './MobileUploadSheet.vue'

const emit = defineEmits<{ logout: [] }>()

type TabKey = 'files' | 'shares' | 'profile'

const tab = ref<TabKey>('files')
const stats = ref<{ fileCount: number; totalBytes: number } | null>(null)

const shareDetail = ref<MobileShareItem | null>(null)
const actionFile = ref<FileItem | null>(null)
const uploadOpen = ref(false)
const sharingFile = ref<FileItem | null>(null)

const filesView = ref<InstanceType<typeof MobileFiles> | null>(null)
const sharesView = ref<InstanceType<typeof MobileShares> | null>(null)

const totalLabel = computed(() =>
  stats.value ? formatBytes(stats.value.totalBytes) : '',
)

async function loadStats(): Promise<void> {
  try {
    stats.value = await api<{ fileCount: number; totalBytes: number }>('/api/stats')
  } catch {
    stats.value = null
  }
}

function switchTab(next: TabKey): void {
  tab.value = next
  shareDetail.value = null
}

function openShareDetail(share: MobileShareItem): void {
  shareDetail.value = share
}

function closeShareDetail(): void {
  shareDetail.value = null
}

function onShareRevoked(): void {
  shareDetail.value = null
  void sharesView.value?.load()
  void loadStats()
}

function openUpload(): void {
  actionFile.value = null
  uploadOpen.value = true
}

function onUploaded(): void {
  void filesView.value?.load(true)
  void loadStats()
}

function closeActionSheet(): void {
  actionFile.value = null
}

function onActionShare(): void {
  if (!actionFile.value) return
  sharingFile.value = actionFile.value
  actionFile.value = null
}

function onActionDownload(): void {
  if (!actionFile.value) return
  window.location.href = `/api/files/${actionFile.value.id}/download`
  actionFile.value = null
}

function onActionDelete(): void {
  if (!actionFile.value) return
  const file = actionFile.value
  actionFile.value = null
  void deleteFile(file)
}

async function deleteFile(file: FileItem): Promise<void> {
  try {
    await api<{ deleted: number }>('/api/files/batch-delete', {
      method: 'POST',
      headers: { Origin: window.location.origin },
      body: JSON.stringify({ ids: [file.id] }),
    })
    toast('文件已删除', 'success')
    void filesView.value?.load(true)
    void loadStats()
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '删除失败，请重试', 'error')
  }
}

function onShared(): void {
  void sharesView.value?.load()
  void loadStats()
}

onMounted(() => void loadStats())
</script>

<template>
  <div class="mobile-app">
    <header class="mobile-header">
      <div class="header-row">
        <div class="brand">
          <img
            class="logo"
            src="/logo.svg"
            alt=""
            aria-hidden="true"
          >
          <h1 class="wordmark">
            Dr<span class="o">o</span>p
          </h1>
        </div>
        <span
          v-if="totalLabel"
          class="usage"
        >{{ totalLabel }}</span>
      </div>
    </header>

    <main class="mobile-body">
      <MobileFiles
        v-show="tab === 'files' && !shareDetail"
        ref="filesView"
        @action="actionFile = $event"
        @upload="openUpload"
      />
      <MobileShares
        v-show="tab === 'shares' && !shareDetail"
        ref="sharesView"
        @open="openShareDetail"
        @gofiles="switchTab('files')"
      />
      <MobileMe
        v-show="tab === 'profile' && !shareDetail"
        @logout="emit('logout')"
      />
      <MobileShareDetail
        v-if="shareDetail"
        :share="shareDetail"
        @back="closeShareDetail"
        @revoked="onShareRevoked"
      />
    </main>

    <button
      v-if="tab === 'files' && !shareDetail"
      type="button"
      class="fab"
      aria-label="上传文件"
      @click="openUpload"
    >
      <AppIcon name="plus" />
    </button>

    <nav
      class="tabbar"
      aria-label="主导航"
    >
      <button
        type="button"
        class="tab-item"
        :class="{ active: tab === 'files' && !shareDetail }"
        @click="switchTab('files')"
      >
        <AppIcon name="folder" />
        <span>文件</span>
      </button>
      <button
        type="button"
        class="tab-item"
        :class="{ active: tab === 'shares' && !shareDetail }"
        @click="switchTab('shares')"
      >
        <AppIcon name="share" />
        <span>分享</span>
      </button>
      <button
        type="button"
        class="tab-item"
        :class="{ active: tab === 'profile' && !shareDetail }"
        @click="switchTab('profile')"
      >
        <AppIcon name="user" />
        <span>我的</span>
      </button>
    </nav>

    <MobileUploadSheet
      v-if="uploadOpen"
      @close="uploadOpen = false"
      @uploaded="onUploaded"
    />

    <MobileActionSheet
      v-if="actionFile"
      :file="actionFile"
      @close="closeActionSheet"
      @share="onActionShare"
      @download="onActionDownload"
      @delete="onActionDelete"
    />

    <ShareDialog
      v-if="sharingFile"
      :file="sharingFile"
      @close="sharingFile = null"
      @shared="onShared"
    />
  </div>
</template>

<style scoped>
.mobile-app {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 480px;
  min-height: 100dvh;
  margin: 0 auto;
  background: var(--drop-background);
}

.mobile-header {
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: 1px solid var(--drop-border);
  background: color-mix(in srgb, var(--drop-background) 95%, transparent);
  backdrop-filter: blur(8px);
}
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 3.5rem;
  padding: 0 1rem;
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.logo {
  width: 1.75rem;
  height: 1.75rem;
  display: block;
}
.wordmark {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--drop-ink);
}
.wordmark .o {
  color: var(--drop-brand);
}
.usage {
  font-size: 0.75rem;
  color: var(--drop-ink-2);
  font-variant-numeric: tabular-nums;
}

.mobile-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-bottom: calc(4rem + env(safe-area-inset-bottom, 0px));
}

.fab {
  position: fixed;
  right: max(1rem, calc((100vw - 30rem) / 2 + 1rem));
  bottom: calc(5.25rem + env(safe-area-inset-bottom, 0px));
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 3.5rem;
  border: 0;
  border-radius: var(--drop-radius-lg);
  background: var(--drop-brand);
  color: #fff;
  box-shadow: var(--drop-shadow-2);
}
.fab:active {
  background: var(--drop-brand-strong);
}

.tabbar {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  width: 100%;
  max-width: 30rem;
  height: calc(4rem + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  border-top: 1px solid var(--drop-border);
  background: var(--drop-background);
}
.tab-item {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  height: 4rem;
  padding: 0 0.25rem;
  border: 0;
  background: transparent;
  color: var(--drop-ink-3);
  font-size: 0.6875rem;
  line-height: 1;
  -webkit-tap-highlight-color: transparent;
}
.tab-item.active {
  color: var(--drop-brand);
  font-weight: 600;
}
</style>
