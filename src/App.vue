<script setup lang="ts">
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import FileList from './components/FileList.vue'
import AuditList from './components/AuditList.vue'
import PasteConfirmDialog from './components/PasteConfirmDialog.vue'
import ShareList from './components/ShareList.vue'
import UploadZone from './components/UploadZone.vue'

const MobileApp = defineAsyncComponent(() => import('./components/mobile/MobileApp.vue'))
const SharePage = defineAsyncComponent(() => import('./components/SharePage.vue'))

import { api, getUserErrorMessage } from './lib/api'
import { filesFromClipboard } from './lib/clipboard'
import { COPY, formatFileCount } from './lib/copy'
import { formatBytes } from './lib/format'
import { clearSharePayload, readSharePayload } from './lib/share-target'
import { toast, useToasts } from './lib/toast'

type AuthState = 'loading' | 'anonymous' | 'owner' | 'unavailable'
const auth = ref<AuthState>('loading')
const fileList = ref<InstanceType<typeof FileList> | null>(null)
const uploadZone = ref<InstanceType<typeof UploadZone> | null>(null)
const stats = ref<{ fileCount: number; totalBytes: number; quotaBytes: number; usedRatio: number } | null>(null)
const hasFiles = ref(false)
const sharedNotice = ref(false)
const pageDragging = ref(false)
const toasts = useToasts()
const shareList = ref<{ load: (reset?: boolean) => Promise<void> } | null>(null)
const auditDialogOpen = ref(false)
const auditTriggerRef = ref<HTMLButtonElement | null>(null)
const logoutBusy = ref(false)
const pendingPasteFiles = ref<File[]>([])
const magicLinkEmail = ref('')
const magicLinkEmailInput = ref<HTMLInputElement | null>(null)
const magicLinkBusy = ref(false)
const magicLinkNotice = ref('')
const magicLinkError = ref('')
const signInLinkRef = ref<HTMLAnchorElement | null>(null)
const isMagicLinkPath = window.location.pathname === '/auth/magic'
const magicLinkToken = isMagicLinkPath
  ? window.location.hash.slice(1)
  : ''

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
  window.addEventListener('keydown', onManagementDialogKeydown)
  mobileQuery.addEventListener('change', onMediaChange)
  window.addEventListener('paste', onPaste)

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
      magicLinkError.value = getUserErrorMessage(cause, COPY.errors.magicLinkInvalid)
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
  window.removeEventListener('keydown', onManagementDialogKeydown)
  mobileQuery.removeEventListener('change', onMediaChange)
  window.removeEventListener('paste', onPaste)
})

function onPaste(event: ClipboardEvent): void {
  if (auth.value !== 'owner' || isMobile.value) return
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
  if (!uploadZone.value) {
    toast(COPY.errors.uploadArea, 'error')
    return
  }
  uploadZone.value.addFiles(files)
  toast(`已添加 ${files.length} 个文件，开始上传`, 'success')
}

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
    stats.value = await api<{ fileCount: number; totalBytes: number; quotaBytes: number; usedRatio: number }>('/api/stats')
  } catch {
    stats.value = null
  }
}

// Refresh the file list and stats in place (no remount) so open dialogs and
// the current tab survive uploads and share creation.
function refresh(): void {
  void fileList.value?.load(true)
  void shareList.value?.load(true)
  void loadStats()
}

function toggleAuditDialog(): void {
  if (auditDialogOpen.value) {
    closeAuditDialog()
    return
  }
  auditDialogOpen.value = true
  void nextTick(() => {
    const dialog = document.getElementById('audit-management-dialog') as HTMLDialogElement | null
    try {
      dialog?.showModal()
    } catch {
      dialog?.setAttribute('open', '')
    }
    dialog?.classList.add('is-visible')
    dialog?.querySelector<HTMLElement>('[autofocus], input, button, [tabindex="-1"]')?.focus()
  })
}

function closeAuditDialog(): void {
  const trigger = auditTriggerRef.value
  auditDialogOpen.value = false
  void nextTick(() => {
    if (trigger?.isConnected) trigger.focus()
  })
}

function onManagementDialogKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.isComposing) return
  if (!auditDialogOpen.value) return
  event.preventDefault()
  closeAuditDialog()
}

function onPageDragOver(): void {
  if (auth.value === 'owner') pageDragging.value = true
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
  if (auth.value !== 'owner') return
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
    stats.value = null
    hasFiles.value = false
    auth.value = 'anonymous'
    void nextTick(() => signInLinkRef.value?.focus())
  } catch (cause) {
    toast(getUserErrorMessage(cause, COPY.errors.logout), 'error')
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
  void nextTick(() => signInLinkRef.value?.focus())
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
    magicLinkError.value = getUserErrorMessage(cause, COPY.errors.magicLink)
  } finally {
    magicLinkBusy.value = false
    if (magicLinkError.value) {
      void nextTick(() => magicLinkEmailInput.value?.focus())
    }
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
    <a
      class="skip-link"
      href="#main-content"
    >
      跳转到主要内容
    </a>
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
          <p
            class="wordmark"
            aria-label="Drop"
          >
            Dr<span class="o">o</span>p
          </p>
        </div>
      </header>
      <main
        id="main-content"
        class="page-content"
      >
        <SharePage :token="shareToken" />
      </main>
    </template>

    <!-- Signed-out: calm brand panel -->
    <template v-else-if="auth !== 'owner'">
      <main
        id="main-content"
        class="page-content"
      >
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
            aria-live="polite"
            aria-atomic="true"
          >
            正在验证登录链接…
          </span>
          <span
            v-else-if="auth === 'loading'"
            class="promise"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            正在检查登录状态…
          </span>
          <p
            v-else-if="auth === 'unavailable'"
            class="error connection-error"
            role="alert"
            aria-atomic="true"
          >
            无法连接服务，请检查网络后刷新页面再登录。
          </p>
          <div
            v-else
            class="login-actions"
          >
            <a
              ref="signInLinkRef"
              class="signin"
              href="/api/auth/github"
            >
              使用 GitHub 登录
            </a>
            <form
              class="magic-link-form"
              :aria-busy="magicLinkBusy"
              @submit.prevent="requestMagicLink"
            >
              <label for="magic-link-email">GitHub 绑定邮箱</label>
              <div class="magic-link-controls">
                <input
                  id="magic-link-email"
                  ref="magicLinkEmailInput"
                  v-model="magicLinkEmail"
                  type="email"
                  autocomplete="email"
                  inputmode="email"
                  placeholder="输入 GitHub 已验证主邮箱"
                  :disabled="magicLinkBusy"
                  :aria-describedby="magicLinkError ? 'magic-link-error' : magicLinkNotice ? 'magic-link-notice' : undefined"
                  :aria-invalid="magicLinkError ? 'true' : undefined"
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
            id="magic-link-notice"
            class="magic-link-notice"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {{ magicLinkNotice }}
          </p>
          <p
            v-if="magicLinkError"
            id="magic-link-error"
            class="error magic-link-error"
            role="alert"
            aria-atomic="true"
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
            aria-live="polite"
            aria-atomic="true"
          >
            {{ formatFileCount(stats.fileCount) }} · 已用 {{ formatBytes(stats.totalBytes) }} / {{ formatBytes(stats.quotaBytes) }}
          </span>
          <div
            class="topbar-actions"
            role="group"
            aria-label="工作区操作"
          >
            <button
              ref="auditTriggerRef"
              class="action-btn action-audit"
              :class="{ active: auditDialogOpen }"
              :aria-expanded="auditDialogOpen"
              aria-controls="audit-management-dialog"
              type="button"
              @click="toggleAuditDialog"
            >
              <span
                class="action-kicker"
                aria-hidden="true"
              >
                &gt;&gt;&gt;&gt; LOG
              </span>
              <span class="action-label">{{ auditDialogOpen ? '关闭记录' : '操作记录' }}</span>
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
          v-if="auditDialogOpen"
          id="audit-management-dialog"
          class="share-management-dialog is-visible"
          aria-labelledby="audit-title"
          aria-modal="true"
          @cancel.prevent="closeAuditDialog"
        >
          <button
            class="management-dialog-close"
            type="button"
            aria-label="关闭操作记录"
            @click="closeAuditDialog"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M5 5 19 19M19 5 5 19"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="square"
              />
            </svg>
          </button>
          <AuditList />
        </dialog>

        <main
          id="main-content"
          class="page-content workspace-page"
        >
          <section
            aria-labelledby="workspace-title"
          >
            <h2
              id="workspace-title"
              class="sr-only"
            >
              文件工作区
            </h2>
            <p
              v-if="sharedNotice"
              class="shared-notice"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              已收到分享的文件，正在加入上传队列
            </p>
            <div class="workspace-grid">
              <section
                class="workspace-panel upload-panel"
                aria-labelledby="upload-panel-title"
              >
                <header class="panel-head">
                  <h3
                    id="upload-panel-title"
                    class="panel-kicker"
                  >
                    上传队列
                  </h3>
                </header>
                <UploadZone
                  ref="uploadZone"
                  :compact="hasFiles"
                  @uploaded="refresh"
                />
              </section>
              <section
                class="workspace-panel files-panel"
                aria-labelledby="files-panel-title"
              >
                <header class="panel-head">
                  <h3
                    id="files-panel-title"
                    class="panel-kicker"
                  >
                    文件列表
                  </h3>
                </header>
                <FileList
                  ref="fileList"
                  @shared="refresh"
                  @hasfiles="hasFiles = $event"
                  @changed="loadStats"
                />
              </section>
              <section
                id="shares-panel"
                class="workspace-panel shares-panel"
                aria-labelledby="shares-panel-title"
              >
                <header class="panel-head">
                  <h3
                    id="shares-panel-title"
                    class="panel-kicker"
                  >
                    分享管理
                  </h3>
                </header>
                <ShareList ref="shareList" />
              </section>
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

    <PasteConfirmDialog
      v-if="pendingPasteFiles.length"
      :files="pendingPasteFiles"
      @confirm="confirmPaste"
      @cancel="cancelPaste"
    />

    <!-- Global toasts -->
    <div
      v-if="toasts.length"
      class="toasts"
      aria-label="通知"
    >
      <div
        v-for="item in toasts"
        :key="item.id"
        class="toast"
        :class="item.kind"
        role="status"
        aria-live="polite"
        aria-atomic="true"
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
