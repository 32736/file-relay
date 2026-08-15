<script setup lang="ts">
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import FileList from './components/FileList.vue'
import ShareList from './components/ShareList.vue'
import UploadZone from './components/UploadZone.vue'

const SharePage = defineAsyncComponent(() => import('./components/SharePage.vue'))

import { api } from './lib/api'
import { formatBytes } from './lib/format'
import { clearSharePayload, readSharePayload } from './lib/share-target'
import { useToasts } from './lib/toast'

type AuthState = 'loading' | 'anonymous' | 'owner'
const auth = ref<AuthState>('loading')
const fileList = ref<InstanceType<typeof FileList> | null>(null)
const uploadZone = ref<InstanceType<typeof UploadZone> | null>(null)
const stats = ref<{ fileCount: number; totalBytes: number } | null>(null)
const hasFiles = ref(false)
const sharedNotice = ref(false)
const pageDragging = ref(false)
const toasts = useToasts()
const shareDialogRef = ref<HTMLDialogElement | null>(null)
const shareDialogOpen = ref(false)
const shareDialogMounted = ref(false)
let shareCloseTimer: ReturnType<typeof setTimeout> | undefined

// Public pages are routed by pathname (no router in this phase):
//   /s/<token>  → public share page
// otherwise the owner workspace.
const shareMatch = /^\/s\/([A-Za-z0-9_-]+)\/?$/.exec(window.location.pathname)
const shareToken = shareMatch?.[1] ?? null

onMounted(async () => {
  try {
    const response = await fetch('/api/auth/me')
    auth.value = response.ok ? 'owner' : 'anonymous'
    if (auth.value === 'owner') {
      void loadStats()
      void consumeShareTarget()
    }
  } catch {
    auth.value = 'anonymous'
  }
})

onBeforeUnmount(() => {
  clearTimeout(shareCloseTimer)
})

// Web Share Target: the service worker stashed shared files in IndexedDB and
// redirected here with ?shared=1; feed them into the upload queue.
async function consumeShareTarget(): Promise<void> {
  if (window.location.search !== '?shared=1') return
  try {
    const payload = await readSharePayload()
    if (payload && payload.files.length > 0) {
      uploadZone.value?.addFiles(payload.files)
      sharedNotice.value = true
      setTimeout(() => (sharedNotice.value = false), 4000)
    }
    await clearSharePayload()
  } catch {
    // Ignore storage failures; the payload simply won't be imported.
  }
}

async function loadStats(): Promise<void> {
  try {
    stats.value = await api<{ fileCount: number; totalBytes: number }>('/api/stats')
  } catch {
    stats.value = null
  }
}

// Refresh the file list and stats in place (no remount) so open dialogs and
// the current tab survive uploads and share creation.
function refresh(): void {
  void fileList.value?.load(true)
  void loadStats()
}

function toggleShareDialog(): void {
  if (shareDialogOpen.value) {
    closeShareDialog()
    return
  }
  clearTimeout(shareCloseTimer)
  shareDialogMounted.value = true
  shareDialogOpen.value = true
  void nextTick(() => {
    const dialog = shareDialogRef.value
    if (!dialog) return
    dialog.show?.()
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => dialog.classList.add('is-visible'))
    } else {
      dialog.classList.add('is-visible')
    }
  })
}

function closeShareDialog(): void {
  shareDialogOpen.value = false
  shareDialogRef.value?.classList.remove('is-visible')
  clearTimeout(shareCloseTimer)
  shareCloseTimer = setTimeout(() => {
    shareDialogRef.value?.close?.()
    shareDialogMounted.value = false
  }, 180)
}

function onPageDragOver(): void {
  if (auth.value === 'owner' && !shareDialogOpen.value) pageDragging.value = true
}

function onPageDrop(event: DragEvent): void {
  pageDragging.value = false
  if (auth.value !== 'owner' || shareDialogOpen.value) return
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length > 0) uploadZone.value?.addFiles(files)
}
</script>

<template>
  <div
    class="shell"
    :class="{ 'page-dragging': pageDragging }"
    @dragover.prevent="onPageDragOver"
    @drop.prevent="onPageDrop"
  >
    <!-- Public share page: slim header + download card -->
    <template v-if="shareToken">
      <header class="public-header">
        <div class="brand-lockup">
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
      </header>
      <main class="page-content">
        <SharePage :token="shareToken" />
      </main>
    </template>

    <!-- Signed-out: calm brand panel -->
    <template v-else-if="auth !== 'owner'">
      <main class="page-content">
        <section
          class="brand-panel"
          aria-labelledby="page-title"
        >
          <img
            class="logo"
            src="/logo.svg"
            alt=""
            aria-hidden="true"
          >
          <h1
            id="page-title"
            class="wordmark"
          >
            Dr<span class="o">o</span>p
          </h1>
          <p class="promise">
            放下一份文件，在任何设备上接住它。为你的设备准备的私人中转站。
          </p>
          <span
            v-if="auth === 'loading'"
            class="promise"
            role="status"
          >
            正在检查登录状态…
          </span>
          <a
            v-else
            class="signin"
            href="/api/auth/github"
          >
            使用 GitHub 登录
          </a>
        </section>
      </main>
    </template>

    <!-- Owner workspace: compact top bar + tabs -->
    <template v-else>
      <header class="topbar">
        <div class="brand-lockup">
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
          v-if="stats"
          class="stats"
          role="status"
        >
          {{ stats.fileCount }} 个文件 · 已用 {{ formatBytes(stats.totalBytes) }}
        </span>
        <nav
          class="tabs top-tabs"
          aria-label="工作区导航"
        >
          <button
            :class="{ active: shareDialogOpen }"
            :aria-expanded="shareDialogOpen"
            type="button"
            @click="toggleShareDialog"
          >
            分享
          </button>
        </nav>
      </header>

      <dialog
        v-if="shareDialogMounted"
        ref="shareDialogRef"
        class="share-management-dialog"
        aria-label="分享管理"
        @cancel.prevent="closeShareDialog"
      >
        <ShareList />
      </dialog>

      <main class="page-content">
        <section
          aria-label="文件工作区"
        >
          <p
            v-if="sharedNotice"
            class="shared-notice"
            role="status"
          >
            已收到分享的文件，正在加入上传队列
          </p>
          <div class="workspace-grid">
            <article class="workspace-panel upload-panel">
              <div class="panel-head">
                <span class="panel-kicker">上传队列</span>
              </div>
              <UploadZone
                ref="uploadZone"
                :compact="hasFiles"
                @uploaded="refresh"
              />
            </article>
            <article class="workspace-panel files-panel">
              <div class="panel-head">
                <span class="panel-kicker">文件台</span>
              </div>
              <FileList
                ref="fileList"
                @shared="refresh"
                @hasfiles="hasFiles = $event"
                @changed="loadStats"
              />
            </article>
          </div>
        </section>
      </main>
    </template>

    <div
      v-if="pageDragging"
      class="page-drop-overlay"
      aria-hidden="true"
    >
      <span>松开即可上传</span>
    </div>

    <!-- Global toasts -->
    <div
      v-if="toasts.length"
      class="toasts"
      aria-live="polite"
    >
      <div
        v-for="item in toasts"
        :key="item.id"
        class="toast"
        :class="item.kind"
        role="status"
      >
        {{ item.message }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.shared-notice {
  color: var(--success);
  margin-bottom: 0.6rem;
}
</style>
