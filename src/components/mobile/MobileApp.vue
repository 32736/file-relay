<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { api, getUserErrorMessage } from '../../lib/api'
import { filesFromClipboard } from '../../lib/clipboard'
import { COPY } from '../../lib/copy'
import { formatBytes } from '../../lib/format'
import { toast } from '../../lib/toast'
import PasteConfirmDialog from '../PasteConfirmDialog.vue'
import FileExpirationDialog from '../FileExpirationDialog.vue'
import ShareDialog from '../ShareDialog.vue'
import type { FileItem } from '../FileList.vue'
import AppIcon from './AppIcon.vue'
import MobileActionSheet from './MobileActionSheet.vue'
import MobileFiles from './MobileFiles.vue'
import MobileShareDetail from './MobileShareDetail.vue'
import MobileShares from './MobileShares.vue'
import type { MobileShareItem } from './MobileShares.vue'
import MobileUploadSheet from './MobileUploadSheet.vue'

const emit = defineEmits<{ logout: [] }>()

type TabKey = 'files' | 'shares'

const tab = ref<TabKey>('files')
const stats = ref<{ fileCount: number; totalBytes: number; quotaBytes: number; usedRatio: number } | null>(null)

const logoutBusy = ref(false)
const shareDetail = ref<MobileShareItem | null>(null)
const actionFile = ref<FileItem | null>(null)
const uploadOpen = ref(false)
const pendingPasteFiles = ref<File[]>([])
const sharingFile = ref<FileItem | null>(null)
const expirationFile = ref<FileItem | null>(null)

const filesView = ref<InstanceType<typeof MobileFiles> | null>(null)
const sharesView = ref<InstanceType<typeof MobileShares> | null>(null)
const filesTab = ref<HTMLButtonElement | null>(null)
const sharesTab = ref<HTMLButtonElement | null>(null)
const uploadSheet = ref<InstanceType<typeof MobileUploadSheet> | null>(null)

const totalLabel = computed(() =>
  stats.value ? `${formatBytes(stats.value.totalBytes)} / ${formatBytes(stats.value.quotaBytes)}` : '',
)

async function loadStats(): Promise<void> {
  try {
    stats.value = await api<{ fileCount: number; totalBytes: number; quotaBytes: number; usedRatio: number }>('/api/stats')
  } catch {
    stats.value = null
  }
}

function switchTab(next: TabKey): void {
  tab.value = next
  shareDetail.value = null
  void nextTick(() => {
    const target = next === 'files' ? filesTab.value : sharesTab.value
    target?.focus()
  })
}

function onTabKeydown(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const current = event.currentTarget === sharesTab.value ? 'shares' : 'files'
  const next = event.key === 'Home'
    ? 'files'
    : event.key === 'End'
      ? 'shares'
      : current === 'files'
        ? 'shares'
        : 'files'
  switchTab(next)
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
  toast(`开始下载：${actionFile.value.name}`, 'info')
  window.location.href = `/api/files/${actionFile.value.id}/download`
  actionFile.value = null
}

function onActionExpiration(): void {
  if (!actionFile.value) return
  expirationFile.value = actionFile.value
  actionFile.value = null
}

function onPaste(event: ClipboardEvent): void {
  if (pendingPasteFiles.value.length > 0) return
  const target = event.target as HTMLElement | null
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target?.isContentEditable
  ) return

  const files = filesFromClipboard(event)
  if (files.length === 0) return
  event.preventDefault()
  pendingPasteFiles.value = files
}

function cancelPaste(): void {
  pendingPasteFiles.value = []
}

function confirmPaste(): void {
  const files = pendingPasteFiles.value
  pendingPasteFiles.value = []
  if (files.length === 0) return
  if (!uploadOpen.value) openUpload()
  void nextTick(() => {
    if (!uploadSheet.value) {
      toast(COPY.errors.uploadArea, 'error')
      return
    }
    uploadSheet.value.addFiles(files)
    toast(`已添加 ${files.length} 个文件，开始上传`, 'success')
  })
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
    toast(COPY.feedback.fileDeleted, 'success')
    void filesView.value?.load(true)
    void loadStats()
  } catch (cause) {
    toast(getUserErrorMessage(cause, COPY.errors.delete), 'error')
  }
}

function onShared(): void {
  void sharesView.value?.load()
  void loadStats()
}

onMounted(() => {
  void loadStats()
  window.addEventListener('paste', onPaste)
})

onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste)
})
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
        <div class="header-actions">
          <span
            v-if="totalLabel"
            class="usage"
          >{{ totalLabel }}</span>
          <button
            type="button"
            class="logout-btn"
            :aria-label="logoutBusy ? '正在退出登录' : '退出登录'"
            title="退出登录"
            :disabled="logoutBusy"
            @click="logout"
          >
            <AppIcon name="log-out" />
          </button>
        </div>
      </div>
    </header>

    <main
      id="main-content"
      class="mobile-body"
    >
      <section
        v-show="tab === 'files' && !shareDetail"
        id="mobile-files-panel"
        class="mobile-panel"
        role="tabpanel"
        aria-labelledby="mobile-files-tab"
      >
        <MobileFiles
          ref="filesView"
          @action="actionFile = $event"
          @upload="openUpload"
        />
      </section>
      <section
        v-show="tab === 'shares' && !shareDetail"
        id="mobile-shares-panel"
        class="mobile-panel"
        role="tabpanel"
        aria-labelledby="mobile-shares-tab"
      >
        <MobileShares
          ref="sharesView"
          @open="openShareDetail"
          @gofiles="switchTab('files')"
        />
      </section>
      <MobileShareDetail
        v-if="shareDetail"
        :share="shareDetail"
        @back="closeShareDetail"
        @revoked="onShareRevoked"
      />
    </main>

    <nav
      class="tabbar"
      aria-label="主导航"
    >
      <div
        class="tab-list"
        role="tablist"
        aria-label="文件与分享"
      >
        <button
          id="mobile-files-tab"
          ref="filesTab"
          type="button"
          role="tab"
          class="tab-item"
          :class="{ active: tab === 'files' }"
          :aria-selected="tab === 'files'"
          aria-controls="mobile-files-panel"
          :tabindex="tab === 'files' ? 0 : -1"
          @click="switchTab('files')"
          @keydown="onTabKeydown"
        >
          <AppIcon name="folder" />
          <span>文件</span>
        </button>
        <button
          id="mobile-shares-tab"
          ref="sharesTab"
          type="button"
          role="tab"
          class="tab-item"
          :class="{ active: tab === 'shares' }"
          :aria-selected="tab === 'shares'"
          aria-controls="mobile-shares-panel"
          :tabindex="tab === 'shares' ? 0 : -1"
          @click="switchTab('shares')"
          @keydown="onTabKeydown"
        >
          <AppIcon name="share" />
          <span>分享</span>
        </button>
      </div>
      <button
        type="button"
        class="tab-upload"
        aria-label="上传文件"
        @click="openUpload"
      >
        <AppIcon name="plus" />
      </button>
    </nav>

    <MobileUploadSheet
      v-if="uploadOpen"
      ref="uploadSheet"
      @close="uploadOpen = false"
      @uploaded="onUploaded"
    />

    <PasteConfirmDialog
      v-if="pendingPasteFiles.length"
      :files="pendingPasteFiles"
      @confirm="confirmPaste"
      @cancel="cancelPaste"
    />

    <MobileActionSheet
      v-if="actionFile"
      :file="actionFile"
      @close="closeActionSheet"
      @share="onActionShare"
      @download="onActionDownload"
      @expiration="onActionExpiration"
      @delete="onActionDelete"
    />

    <FileExpirationDialog
      v-if="expirationFile"
      :file="expirationFile"
      @close="expirationFile = null"
      @saved="expirationFile = null; void filesView?.load(true); void loadStats()"
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
  height: 100dvh;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  background: var(--drop-background);
}

.mobile-header {
  position: sticky;
  top: 0;
  z-index: 20;
  border-top: 4px solid var(--drop-brand);
  border-bottom: 1px solid var(--drop-line);
  background: var(--drop-surface);
}
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 2.75rem;
  padding: 0 var(--drop-mobile-gutter);
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.logo {
  width: 1.25rem;
  height: 1.25rem;
  display: block;
}
.wordmark {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 900;
  letter-spacing: -0.03em;
  text-transform: uppercase;
  font-family: var(--font-macro);
  color: var(--drop-ink);
}
.wordmark .o {
  color: var(--drop-brand);
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.usage {
  font-family: var(--font-micro);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--drop-ink-3);
  font-variant-numeric: tabular-nums;
}
.usage::before,
.usage::after {
  content: none;
}
.logout-btn {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  box-sizing: border-box;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--drop-brand);
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--drop-dur-fast) linear, color var(--drop-dur-fast) linear, border-color var(--drop-dur-fast) linear;
}
.logout-btn::before {
  content: "";
  position: absolute;
  inset: 0.25rem;
  border: 2px solid var(--drop-brand);
  background: var(--drop-brand-tint);
  box-shadow: 2px 2px 0 var(--drop-ink);
  transition: background-color var(--drop-dur-fast) linear, border-color var(--drop-dur-fast) linear;
}
.logout-btn :deep(svg) {
  position: relative;
  z-index: 1;
  width: 1rem;
  height: 1rem;
}
.logout-btn:hover:not(:disabled) {
  color: var(--drop-background);
}
.logout-btn:hover:not(:disabled)::before {
  border-color: var(--drop-ink);
  background: var(--drop-brand);
}
.logout-btn:active {
  color: var(--drop-background);
  transform: translate(2px, 2px);
}
.logout-btn:active::before {
  background: var(--drop-brand-strong);
  border-color: var(--drop-ink);
  box-shadow: 0 0 0 var(--drop-ink);
}
.logout-btn:focus-visible { outline: 2px solid var(--drop-brand); outline-offset: 2px; }
.logout-btn:disabled {
  opacity: 0.5;
}

.mobile-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: calc(3.5rem + env(safe-area-inset-bottom, 0px));
}
.mobile-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tabbar {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  display: block;
  width: 100%;
  height: calc(3.5rem + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  border-top: 1px solid var(--drop-line);
  background: var(--drop-surface);
}
.tab-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  width: 100%;
  height: 3.5rem;
}
.tab-item {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  height: 3.5rem;
  padding: 0 0.25rem;
  border: 0;
  background: transparent;
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1;
  -webkit-tap-highlight-color: transparent;
  transition: color var(--drop-dur-fast) linear;
}
.tab-item.active {
  color: var(--drop-brand);
}
.tab-item.active::before {
  content: "";
  position: absolute;
  top: 0;
  left: 25%;
  right: 25%;
  height: 2px;
  background: var(--drop-brand);
}
.tab-upload {
  position: absolute;
  top: 0;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  margin: 0;
  border: 2px solid var(--drop-ink);
  border-radius: 0;
  background: var(--drop-brand);
  color: var(--drop-background);
  box-shadow: 2px 2px 0 var(--drop-ink);
  transform: translate(-50%, -0.375rem);
  transition: transform var(--drop-dur-fast) linear, box-shadow var(--drop-dur-fast) linear;
}
.tab-upload:active {
  transform: translate(-50%, -0.25rem);
  box-shadow: 1px 1px 0 var(--drop-ink);
}
</style>
