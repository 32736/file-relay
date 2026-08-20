<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { api, getUserErrorMessage } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { COPY, getShareStatusLabel } from '../../lib/copy'
import { formatDate } from '../../lib/format'
import { loadShareUrls } from '../../lib/share-urls'
import { toast } from '../../lib/toast'
import AppIcon from './AppIcon.vue'
import type { MobileShareItem } from './MobileShares.vue'

const props = defineProps<{ share: MobileShareItem }>()
const emit = defineEmits<{ back: []; revoked: [] }>()

const busy = ref(false)
const error = ref<string | null>(null)
const copied = ref(false)
const shareUrl = ref('')
const qrCanvas = ref<HTMLCanvasElement | null>(null)
const backButton = ref<HTMLButtonElement | null>(null)
const returnFocus = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
  ? document.activeElement
  : null

function stateLabel(): string {
  return getShareStatusLabel(props.share)
}

const isActive = computed(() => stateLabel() === '有效')

function daysLeft(): number | null {
  if (props.share.expiresAt === null) return null
  return Math.max(0, Math.ceil((props.share.expiresAt - Math.floor(Date.now() / 1000)) / 86400))
}

async function copyUrl(): Promise<void> {
  if (!shareUrl.value || !isActive.value) return
  try {
    await copyText(shareUrl.value)
    toast(COPY.feedback.linkCopied, 'success')
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch (cause) {
    toast(getUserErrorMessage(cause, COPY.errors.copy), 'error')
  }
}

async function revoke(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    await api(`/api/shares/${props.share.id}`, { method: 'DELETE' })
    toast(COPY.feedback.shareRevoked, 'success')
    emit('revoked')
  } catch (cause) {
    error.value = getUserErrorMessage(cause, COPY.errors.shareRevoke)
    toast(error.value, 'error')
  } finally {
    busy.value = false
  }
}

function onPopState(): void {
  emit('back')
}

function goBack(): void {
  if (window.history.length > 1) {
    window.history.back()
  } else {
    emit('back')
  }
}

onMounted(async () => {
  window.history.pushState({ view: 'share-detail' }, '', '')
  window.addEventListener('popstate', onPopState)
  await nextTick()
  backButton.value?.focus()

  // Server-recovered URL first (works on any logged-in device); the local
  // cache only backs up legacy shares created before server-side recovery.
  shareUrl.value = props.share.url ?? loadShareUrls()[props.share.id] ?? ''
  if (shareUrl.value) {
    try {
      await nextTick()
      if (qrCanvas.value) {
        const { default: QRCode } = await import('qrcode')
        await QRCode.toCanvas(qrCanvas.value, shareUrl.value, { width: 112 })
      }
    } catch {
      toast(COPY.errors.qrCode, 'error')
    }
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('popstate', onPopState)
  void nextTick(() => {
    if (returnFocus?.isConnected) returnFocus.focus()
  })
})
</script>

<template>
  <section
    class="detail"
    aria-labelledby="mobile-share-detail-title"
  >
    <header class="detail-header">
      <button
        ref="backButton"
        type="button"
        class="back-btn"
        aria-label="返回"
        @click="goBack"
      >
        <AppIcon name="chevron-left" />
      </button>
      <h2
        id="mobile-share-detail-title"
        class="detail-title"
      >
        {{ COPY.shares.detail }}
      </h2>
    </header>

    <p
      v-if="error"
      class="error"
      role="alert"
      aria-atomic="true"
    >
      {{ error }}
    </p>

    <div class="card file-card">
      <div class="file-head">
        <span class="tile">
          <AppIcon name="link" />
        </span>
        <div class="file-body">
          <div class="file-name">
            {{ share.fileName || '未命名文件' }}
          </div>
          <div class="file-meta">
            创建于 {{ formatDate(share.createdAt) }}
          </div>
        </div>
        <span
          class="badge"
          :class="stateLabel() === '有效' ? 'active' : 'inactive'"
        >{{ stateLabel() }}</span>
      </div>
    </div>

    <div class="card">
      <div
        v-if="shareUrl && isActive"
        class="link-row"
      >
        <AppIcon
          class="link-icon"
          name="link"
        />
        <span class="link-text">{{ shareUrl }}</span>
        <button
          type="button"
          class="copy-btn"
          :aria-label="copied ? '已复制' : '复制链接'"
          @click="copyUrl"
        >
          <AppIcon :name="copied ? 'check' : 'copy'" />
        </button>
      </div>
      <p
        v-else
        class="url-missing"
      >
        {{ isActive ? '当前设备暂时无法获取分享链接，请重新创建分享。' : '分享已失效，无法复制链接。' }}
      </p>
      <div
        v-if="shareUrl && isActive"
        class="qr-wrap"
      >
        <canvas
          ref="qrCanvas"
          class="qr"
          aria-label="分享二维码"
        />
      </div>
    </div>

    <div class="card">
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-value">
            <span class="stat-number">{{ share.downloadCount }}</span>
            <span class="stat-unit">次</span>
          </div>
          <div class="stat-label">
            下载次数
          </div>
        </div>
        <div class="stat">
          <div class="stat-value">
            <span class="stat-number">{{ daysLeft() === null ? '∞' : daysLeft() }}</span>
            <span
              v-if="daysLeft() !== null"
              class="stat-unit"
            >天</span>
          </div>
          <div class="stat-label">
            {{ share.expiresAt === null ? '永久有效' : '剩余天数' }}
          </div>
        </div>
        <div class="stat">
          <div class="stat-value">
            <span class="stat-number">{{ share.maxDownloads ?? '∞' }}</span>
            <span
              v-if="share.maxDownloads !== null"
              class="stat-unit"
            >次</span>
          </div>
          <div class="stat-label">
            下载上限
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="share.revokedAt === null"
      class="manage"
    >
      <button
        type="button"
        class="revoke"
        :disabled="busy"
        @click="revoke"
      >
        {{ busy ? '撤销中…' : COPY.actions.revokeShare }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.detail {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 0 var(--drop-mobile-gutter) 0.875rem;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  height: 2.5rem;
  border-bottom: 2px solid var(--drop-ink);
  margin: 0 0 0.125rem;
  padding: 0;
}

.back-btn {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  margin-left: -0.375rem;
  box-sizing: border-box;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--drop-ink);
  -webkit-tap-highlight-color: transparent;
  transition: color var(--drop-dur-fast) linear, transform var(--drop-dur-fast) linear;
}
.back-btn::before {
  content: "";
  position: absolute;
  inset: 0.375rem;
  border: 1px solid var(--drop-ink);
  border-left: 3px solid var(--drop-brand);
  background: var(--drop-surface-2);
  box-shadow: 2px 2px 0 var(--drop-ink);
  transition: background-color var(--drop-dur-fast) linear, border-color var(--drop-dur-fast) linear, box-shadow var(--drop-dur-fast) linear;
}
.back-btn :deep(svg) {
  position: relative;
  z-index: 1;
  width: 1rem;
  height: 1rem;
}
.back-btn:hover {
  color: var(--drop-background);
}
.back-btn:hover::before {
  border-color: var(--drop-ink);
  background: var(--drop-brand);
}
.back-btn:active {
  color: var(--drop-background);
  transform: translate(2px, 2px);
}
.back-btn:active::before {
  background: var(--drop-brand-strong);
  box-shadow: 0 0 0 var(--drop-ink);
}
.back-btn:focus-visible { outline: 2px solid var(--drop-brand); outline-offset: 2px; }

.detail-title {
  flex: 1;
  margin: 0;
  font-family: var(--font-micro);
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--drop-ink);
}

.manage {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin-top: auto;
  padding-top: 0.375rem;
}
.revoke {
  width: 100%;
  min-height: 2.5rem;
  border: 1px solid var(--drop-state-error);
  border-radius: 0;
  background: transparent;
  color: var(--drop-state-error);
  font-family: var(--font-micro);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  box-shadow: var(--drop-shadow-1);
  transition: background-color var(--drop-dur-fast) linear, color var(--drop-dur-fast) linear, transform var(--drop-dur-fast) linear, box-shadow var(--drop-dur-fast) linear;
}
.revoke:active {
  background: var(--drop-state-error);
  color: var(--drop-background);
  transform: translate(2px, 2px);
  box-shadow: 0 0 0 #000000;
}
.revoke:disabled {
  opacity: 0.5;
}

.card {
  padding: 0.75rem;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: var(--drop-card);
  box-shadow: var(--drop-shadow-1);
}

.file-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.tile {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: 1px solid var(--drop-brand);
  border-radius: 0;
  background: var(--drop-surface-2);
  color: var(--drop-brand);
}
.tile :deep(svg) {
  width: 0.875rem;
  height: 0.875rem;
}
.file-body {
  flex: 1;
  min-width: 0;
}
.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--drop-ink);
}
.file-meta {
  margin-top: 0.125rem;
  font-family: var(--font-micro);
  font-size: 0.66rem;
  color: var(--drop-ink-3);
}
.badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.125rem 0.4rem;
  border: 1px solid currentColor;
  border-radius: 0;
  font-family: var(--font-micro);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
.badge.active {
  background: transparent;
  color: var(--drop-state-success);
}
.badge.inactive {
  background: transparent;
  color: var(--drop-state-error);
}

.link-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--drop-ink);
  border-left: 4px solid var(--drop-brand);
  border-radius: 0;
  background: var(--drop-surface-2);
}
.link-icon {
  width: 0.75rem;
  height: 0.75rem;
  color: var(--drop-ink-3);
}
.link-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.6875rem;
  font-family: var(--font-micro);
  color: var(--drop-ink-2);
}
.copy-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  height: 1.25rem;
  aspect-ratio: 1;
  box-sizing: border-box;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: transparent;
  color: var(--drop-brand);
  transition: background-color var(--drop-dur-fast) linear, color var(--drop-dur-fast) linear;
}
.copy-btn :deep(svg) {
  width: 0.875rem;
  height: 0.875rem;
}
.copy-btn:active {
  background: var(--drop-brand);
  color: var(--drop-background);
}

.url-missing {
  margin: 0;
  font-family: var(--font-micro);
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--drop-ink-3);
}
.url-missing::before {
  content: ">>> ";
  color: var(--drop-brand);
}

.qr-wrap {
  display: flex;
  justify-content: center;
  margin-top: 0.5rem;
}
.qr {
  padding: 0.375rem;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: #FFFFFF;
}

.stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
}
.stat {
  text-align: center;
  padding: 0.125rem 0.125rem;
}
.stat + .stat {
  border-left: 1px solid var(--drop-line);
}
.stat-value {
  line-height: 1.2;
}
.stat-number {
  font-size: 1.125rem;
  font-weight: 900;
  font-family: var(--font-macro);
  color: var(--drop-ink);
  font-variant-numeric: tabular-nums;
}
.stat-unit {
  margin-left: 0.125rem;
  font-family: var(--font-micro);
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--drop-ink-3);
}
.stat-label {
  margin-top: 0.125rem;
  font-family: var(--font-micro);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--drop-ink-3);
}

.error {
  margin: 0;
  color: var(--drop-state-error);
  font-family: var(--font-micro);
  font-size: 0.8rem;
}
</style>
