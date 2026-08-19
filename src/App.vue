<script setup lang="ts">
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import FileList from './components/FileList.vue'
import UploadZone from './components/UploadZone.vue'

const MobileApp = defineAsyncComponent(() => import('./components/mobile/MobileApp.vue'))
const ShareList = defineAsyncComponent(() => import('./components/ShareList.vue'))
const SharePage = defineAsyncComponent(() => import('./components/SharePage.vue'))

import { api } from './lib/api'
import { formatBytes } from './lib/format'
import { clearSharePayload, readSharePayload } from './lib/share-target'
import { toast, useToasts } from './lib/toast'

type AuthState = 'loading' | 'anonymous' | 'owner' | 'unavailable'
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
const logoutBusy = ref(false)
const magicLinkEmail = ref('')
const magicLinkBusy = ref(false)
const magicLinkNotice = ref('')
const magicLinkError = ref('')
const isMagicLinkPath = window.location.pathname === '/auth/magic'
const magicLinkToken = isMagicLinkPath
  ? window.location.hash.slice(1)
  : ''
let shareCloseTimer: ReturnType<typeof setTimeout> | undefined

// Below 768px the owner workspace mounts the drop-mobile component tree
// (bottom tab navigation) instead of the desktop panels.
const mobileQuery = window.matchMedia('(max-width: 767px)')
const isMobile = ref(mobileQuery.matches)

function onMediaChange(event: MediaQueryListEvent): void {
  isMobile.value = event.matches
}

// Public pages are routed by pathname (no router in this phase):
//   /s/<token>  → public share page
// otherwise the owner workspace.
const shareMatch = /^\/s\/([A-Za-z0-9_-]+)\/?$/.exec(window.location.pathname)
const shareToken = shareMatch?.[1] ?? null

onMounted(async () => {
  window.addEventListener('keydown', onShareDialogKeydown)
  mobileQuery.addEventListener('change', onMediaChange)

  if (isMagicLinkPath) {
    history.replaceState(null, '', '/auth/magic')
    if (!magicLinkToken) {
      magicLinkError.value = '登录链接无效或已过期'
      auth.value = 'anonymous'
      return
    }
    try {
      await api('/api/auth/magic-link/verify', {
        method: 'POST',
        headers: { Origin: window.location.origin },
        body: JSON.stringify({ token: magicLinkToken }),
      })
      window.location.replace('/')
    } catch (cause) {
      magicLinkError.value = cause instanceof Error ? cause.message : '登录链接无效或已过期'
      auth.value = 'anonymous'
    }
    return
  }

  try {
    const response = await fetch('/api/auth/me')
    auth.value = response.ok ? 'owner' : response.status === 401 ? 'anonymous' : 'unavailable'
    if (auth.value === 'owner') {
      void loadStats()
      void consumeShareTarget()
    }
  } catch {
    auth.value = 'unavailable'
  }
})

onBeforeUnmount(() => {
  clearTimeout(shareCloseTimer)
  window.removeEventListener('keydown', onShareDialogKeydown)
  mobileQuery.removeEventListener('change', onMediaChange)
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

function onShareDialogKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.isComposing || !shareDialogOpen.value) return
  event.preventDefault()
  closeShareDialog()
}

function onPageDragOver(): void {
  if (auth.value === 'owner' && !shareDialogOpen.value) pageDragging.value = true
}

// dragleave on the shell fires when the pointer leaves any child, so we only
// treat a leave as "left the window" when the relatedTarget is null (outside
// the viewport) AND the pointer coordinates are at or past the viewport edge.
function onPageDragLeave(event: DragEvent): void {
  const target = event.relatedTarget as Node | null
  if (target && (event.target as Node | null)?.contains?.(target)) return
  const { clientX, clientY } = event
  if (
    clientX <= 0 ||
    clientY <= 0 ||
    clientX >= window.innerWidth - 1 ||
    clientY >= window.innerHeight - 1 ||
    target === null
  ) {
    pageDragging.value = false
  }
}

function onPageDrop(event: DragEvent): void {
  pageDragging.value = false
  if (auth.value !== 'owner' || shareDialogOpen.value) return
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length > 0) uploadZone.value?.addFiles(files)
}

async function logout(): Promise<void> {
  if (logoutBusy.value) return

  logoutBusy.value = true
  try {
    await api<void>('/api/auth/logout', {
      method: 'POST',
      headers: { Origin: window.location.origin },
    })
    closeShareDialog()
    stats.value = null
    hasFiles.value = false
    auth.value = 'anonymous'
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '退出登录失败，请重试', 'error')
  } finally {
    logoutBusy.value = false
  }
}

// MobileApp's profile page performs the logout API call itself and only
// reports success; reset the local owner state here.
function onMobileLoggedOut(): void {
  stats.value = null
  hasFiles.value = false
  auth.value = 'anonymous'
}

async function requestMagicLink(): Promise<void> {
  if (magicLinkBusy.value) return

  magicLinkBusy.value = true
  magicLinkError.value = ''
  magicLinkNotice.value = ''
  try {
    await api<void>('/api/auth/magic-link', {
      method: 'POST',
      headers: { Origin: window.location.origin },
      body: JSON.stringify({ email: magicLinkEmail.value }),
    })
    magicLinkNotice.value = '如果该邮箱与 GitHub 已验证主邮箱一致，登录链接已发送。'
  } catch (cause) {
    magicLinkError.value = cause instanceof Error ? cause.message : '发送登录链接失败，请稍后重试'
  } finally {
    magicLinkBusy.value = false
  }
}
</script>

<template>
  <div
    class="shell"
    :class="{ 'page-dragging': pageDragging }"
    @dragover.prevent="onPageDragOver"
    @dragleave.prevent="onPageDragLeave"
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
          <span class="tech-tag">PRIVATE FILE RELAY / REV 2.6</span>
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
            v-if="isMagicLinkPath && !magicLinkError"
            class="promise"
            role="status"
          >
            正在验证登录链接…
          </span>
          <span
            v-else-if="auth === 'loading'"
            class="promise"
            role="status"
          >
            正在检查登录状态…
          </span>
          <p
            v-else-if="auth === 'unavailable'"
            class="error connection-error"
            role="alert"
          >
            无法连接服务，请检查网络后刷新页面再登录。
          </p>
          <div
            v-else
            class="login-actions"
          >
            <a
              class="signin"
              href="/api/auth/github"
            >
              使用 GitHub 登录
            </a>
            <form
              class="magic-link-form"
              @submit.prevent="requestMagicLink"
            >
              <label for="magic-link-email">GitHub 绑定邮箱</label>
              <div class="magic-link-controls">
                <input
                  id="magic-link-email"
                  v-model="magicLinkEmail"
                  type="email"
                  autocomplete="email"
                  inputmode="email"
                  placeholder="输入 GitHub 已验证主邮箱"
                  :disabled="magicLinkBusy"
                  required
                >
                <button
                  class="btn-secondary"
                  type="submit"
                  :disabled="magicLinkBusy"
                >
                  {{ magicLinkBusy ? '发送中…' : '发送登录链接' }}
                </button>
              </div>
            </form>
          </div>
          <p
            v-if="magicLinkNotice"
            class="magic-link-notice"
            role="status"
          >
            {{ magicLinkNotice }}
          </p>
          <p
            v-if="magicLinkError"
            class="error magic-link-error"
            role="alert"
          >
            {{ magicLinkError }}
          </p>
        </section>
      </main>
    </template>

    <!-- Owner workspace: mobile tree (drop-mobile) or desktop panels -->
    <template v-else>
      <MobileApp
        v-if="isMobile"
        @logout="onMobileLoggedOut"
      />
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
            <span
              class="topbar-tag"
              aria-hidden="true"
            >/// <b>FILE RELAY</b> — UNIT D-01</span>
          </div>
          <span
            v-if="stats"
            class="stats"
            role="status"
          >
            {{ stats.fileCount }} 个文件 · 已用 {{ formatBytes(stats.totalBytes) }}
          </span>
          <div
            class="topbar-actions"
            role="group"
            aria-label="工作区操作"
          >
            <button
              class="action-btn action-share"
              :class="{ active: shareDialogOpen }"
              :aria-expanded="shareDialogOpen"
              type="button"
              @click="toggleShareDialog"
            >
              <span
                class="action-kicker"
                aria-hidden="true"
              >>>> SHARES</span>
              <span class="action-label">{{ shareDialogOpen ? '关闭面板' : '分享管理' }}</span>
            </button>
            <span
              class="action-sep"
              aria-hidden="true"
            />
            <button
              class="action-btn action-logout"
              type="button"
              :disabled="logoutBusy"
              @click="logout"
            >
              <span
                class="action-kicker"
                aria-hidden="true"
              >[ EXIT ]</span>
              <span class="action-label">{{ logoutBusy ? '退出中…' : '退出登录' }}</span>
            </button>
          </div>
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
  color: var(--drop-state-success);
  margin-bottom: 0.6rem;
}
</style>
