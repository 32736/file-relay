<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

import { api } from '../../lib/api'
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

function stateLabel(): string {
  if (props.share.revokedAt !== null) return '已撤销'
  if (props.share.expiresAt !== null && props.share.expiresAt <= Math.floor(Date.now() / 1000)) {
    return '已过期'
  }
  return props.share.maxDownloads !== null && props.share.downloadCount >= props.share.maxDownloads
    ? '已耗尽'
    : '有效'
}

const isActive = computed(() => stateLabel() === '有效')

function daysLeft(): number | null {
  if (props.share.expiresAt === null) return null
  return Math.max(0, Math.ceil((props.share.expiresAt - Math.floor(Date.now() / 1000)) / 86400))
}

async function copyUrl(): Promise<void> {
  if (!shareUrl.value || !isActive.value) return
  await navigator.clipboard.writeText(shareUrl.value)
  toast('链接已复制', 'success')
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

async function revoke(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    await api(`/api/shares/${props.share.id}`, { method: 'DELETE' })
    toast('分享已撤销', 'success')
    emit('revoked')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  shareUrl.value = loadShareUrls()[props.share.id] ?? ''
  if (shareUrl.value) {
    await nextTick()
    if (qrCanvas.value) {
      const { default: QRCode } = await import('qrcode')
      await QRCode.toCanvas(qrCanvas.value, shareUrl.value, { width: 112 })
    }
  }
})
</script>

<template>
  <section
    class="detail"
    aria-label="分享详情"
  >
    <p
      v-if="error"
      class="error"
      role="alert"
    >
      {{ error }}
    </p>

    <section class="card file-card">
      <div class="file-head">
        <span class="tile">
          <AppIcon name="link" />
        </span>
        <div class="file-body">
          <div class="file-name">
            {{ share.fileName ?? share.fileId }}
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
    </section>

    <section class="card">
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
          @click="copyUrl"
        >
          <AppIcon :name="copied ? 'check' : 'copy'" />
          <span>{{ copied ? '已复制' : '复制' }}</span>
        </button>
      </div>
      <p
        v-else
        class="url-missing"
      >
        {{ isActive ? '分享链接仅在本设备创建时可见，其他设备无法复制。' : '分享已失效，无法复制链接。' }}
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
    </section>

    <section class="card">
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
    </section>

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
        {{ busy ? '撤销中…' : '撤销分享' }}
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
  gap: 0.75rem;
  padding: 1rem 1rem 1.5rem;
}

.card {
  padding: 1rem;
  border: 1px solid var(--drop-border);
  border-radius: var(--drop-radius-lg);
  background: var(--drop-card);
}

.file-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.tile {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--drop-radius-md);
  background: var(--drop-brand-tint);
  color: var(--drop-brand);
}
.tile :deep(svg) {
  width: 1.25rem;
  height: 1.25rem;
}
.file-body {
  flex: 1;
  min-width: 0;
}
.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1rem;
  font-weight: 500;
  color: var(--drop-ink);
}
.file-meta {
  margin-top: 0.125rem;
  font-size: 0.75rem;
  color: var(--drop-ink-3);
}
.badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem 0.625rem;
  border-radius: var(--drop-radius-pill);
  font-size: 0.6875rem;
  font-weight: 500;
  white-space: nowrap;
}
.badge.active {
  background: color-mix(in srgb, var(--drop-state-success) 10%, transparent);
  color: var(--drop-state-success);
}
.badge.inactive {
  background: var(--drop-muted);
  color: var(--drop-ink-3);
}

.link-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem;
  border-radius: var(--drop-radius-md);
  background: var(--drop-surface-2);
}
.link-icon {
  width: 1rem;
  height: 1rem;
  color: var(--drop-ink-3);
}
.link-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  font-family: ui-monospace, "SFMono-Regular", monospace;
  color: var(--drop-ink-2);
}
.copy-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-height: 2.25rem;
  padding: 0 0.5rem;
  border: 0;
  border-radius: var(--drop-radius-sm);
  background: transparent;
  color: var(--drop-brand);
  font-size: 0.8125rem;
  font-weight: 500;
}
.copy-btn :deep(svg) {
  width: 1rem;
  height: 1rem;
}
.copy-btn:active {
  opacity: 0.6;
}

.url-missing {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--drop-ink-3);
}

.qr-wrap {
  display: flex;
  justify-content: center;
  margin-top: 1rem;
}
.qr {
  padding: 0.5rem;
  border-radius: var(--drop-radius-md);
  background: var(--drop-surface-2);
}

.stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
}
.stat {
  text-align: center;
  padding: 0.25rem 0.5rem;
}
.stat + .stat {
  border-left: 1px solid var(--drop-border);
}
.stat-value {
  line-height: 1.2;
}
.stat-number {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--drop-ink);
}
.stat-unit {
  margin-left: 0.125rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--drop-ink-3);
}
.stat-label {
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: var(--drop-ink-3);
}

.manage {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.revoke {
  width: 100%;
  min-height: 2.75rem;
  border: 0;
  border-radius: var(--drop-radius-md);
  background: var(--drop-surface-2);
  color: var(--drop-state-error);
  font-size: 0.875rem;
  font-weight: 500;
}
.revoke:active {
  opacity: 0.6;
}
.revoke:disabled {
  opacity: 0.5;
}

.error {
  margin: 0;
  color: var(--drop-state-error);
  font-size: 0.875rem;
}
</style>
