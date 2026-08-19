<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

const dialogRef = ref<HTMLDialogElement | null>(null)

import { api } from '../lib/api'
import { formatDate } from '../lib/format'
import { saveShareUrl } from '../lib/share-urls'
import { toast } from '../lib/toast'
import type { FileItem } from './FileList.vue'

const props = defineProps<{ file: FileItem }>()
const emit = defineEmits<{ close: []; shared: [] }>()

interface ShareResult {
  id: string
  url: string
  expiresAt: number | null
  maxDownloads: number | null
  deleteFileAfterExhausted: boolean
}

const expiresHours = ref<number | null>(null)
const maxDownloads = ref<number | null>(null)
const burnAfterReading = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const result = ref<ShareResult | null>(null)
const qrCanvas = ref<HTMLCanvasElement | null>(null)
const copied = ref(false)

async function createShare(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const body: Record<string, unknown> = {}
    if (expiresHours.value) body.expiresIn = expiresHours.value * 3600
    if (maxDownloads.value) body.maxDownloads = maxDownloads.value
    if (burnAfterReading.value) {
      body.maxDownloads = 1
      body.deleteFileAfterExhausted = true
    }
    result.value = await api<ShareResult>(`/api/files/${props.file.id}/shares`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    saveShareUrl(result.value.id, result.value.url)
    toast('分享已创建', 'success')
    emit('shared')
    await nextTick()
    if (qrCanvas.value) {
      const { default: QRCode } = await import('qrcode')
      await QRCode.toCanvas(qrCanvas.value, result.value.url, { width: 160 })
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

async function copyUrl(): Promise<void> {
  if (!result.value) return
  await navigator.clipboard.writeText(result.value.url)
  toast('链接已复制', 'success')
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

onMounted(() => {
  nextTick(() => {
    if (dialogRef.value && !dialogRef.value.open) dialogRef.value.showModal?.()
  })
})
</script>

<template>
  <dialog
    ref="dialogRef"
    class="dialog"
    aria-label="分享文件"
    @cancel.prevent="emit('close')"
    @click.self="emit('close')"
  >
    <h3 class="dialog-title">
      <span
        class="title-text"
        :title="file.name"
      >{{ file.name }}</span>
    </h3>

    <form
      v-if="!result"
      @submit.prevent="createShare"
    >
      <label>
        有效期（小时，留空为永久）
        <input
          v-model.number="expiresHours"
          type="number"
          min="1"
        >
      </label>
      <label>
        下载次数上限（留空不限）
        <input
          v-model.number="maxDownloads"
          type="number"
          min="1"
        >
      </label>
      <label class="check">
        <input
          v-model="burnAfterReading"
          type="checkbox"
        >
        阅后即焚（下载 1 次后失效并删除）
      </label>
      <p
        v-if="error"
        class="error"
        role="alert"
      >
        {{ error }}
      </p>
      <div class="buttons">
        <button
          class="btn-primary"
          type="submit"
          :disabled="busy"
        >
          {{ busy ? '创建中…' : '创建分享' }}
        </button>
      </div>
    </form>

    <div
      v-else
      class="result"
    >
      <canvas
        ref="qrCanvas"
        class="qr"
        aria-label="分享二维码"
      />
      <p class="url">
        {{ result.url }}
      </p>
      <p
        v-if="result.expiresAt"
        class="hint"
      >
        有效期至 {{ formatDate(result.expiresAt) }}
      </p>
      <div class="buttons">
        <button
          type="button"
          class="ghost"
          @click="copyUrl"
        >
          {{ copied ? '已复制' : '复制链接' }}
        </button>
        <button
          type="button"
          class="ghost"
          @click="emit('close')"
        >
          完成
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.dialog {
  margin: auto;
  background: var(--surface);
  border: 1px solid rgba(15, 15, 18, 0.08);
  border-radius: var(--radius-lg);
  padding: 1.5rem 1.75rem;
  max-width: 26rem;
  width: 90%;
  box-shadow: var(--drop-shadow-4), var(--drop-inner-highlight);
  animation: dialog-in 0.25s var(--drop-ease-spring);
}
@keyframes dialog-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.dialog::backdrop {
  background: rgba(15, 15, 18, 0.45);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.dialog-title {
  margin: 0 0 1rem;
  font-size: 1rem;
  font-weight: 650;
  line-height: 1.4;
  color: var(--text);
  overflow: hidden;
  letter-spacing: -0.02em;
}
.title-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
label {
  display: block;
  margin-bottom: 0.875rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text);
}
label input[type='number'],
label input[type='password'] {
  display: block;
  width: 100%;
  margin-top: 0.375rem;
  min-height: 2.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font-size: 0.9rem;
  transition: border-color var(--drop-dur-base) var(--drop-ease-spring), box-shadow var(--drop-dur-base) var(--drop-ease-spring);
}
label input[type='number']:focus,
label input[type='password']:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 4px rgba(230, 57, 70, 0.1);
}
.check {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--bg-warm);
}
.check input[type='checkbox'] {
  accent-color: var(--primary);
}
.buttons {
  display: flex;
  gap: 0.6rem;
  justify-content: flex-end;
  margin-top: 1rem;
}
button {
  min-height: 2.75rem;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  cursor: pointer;
  font-weight: 500;
  transition: border-color var(--drop-dur-base) var(--drop-ease-spring), background-color var(--drop-dur-base) var(--drop-ease-spring), color var(--drop-dur-base) var(--drop-ease-spring), box-shadow var(--drop-dur-base) var(--drop-ease-spring), transform var(--drop-dur-base) var(--drop-ease-spring);
}
button[type='submit'] {
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
  color: #fff;
  border: 0;
  box-shadow: 0 4px 14px -2px rgba(230, 57, 70, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15);
}
button[type='submit']:not(:disabled):hover {
  filter: brightness(1.05);
  box-shadow: 0 6px 20px -2px rgba(230, 57, 70, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.15);
}
button[type='submit']:active {
  transform: scale(0.98);
}
button.ghost {
  background: var(--surface);
}
button.ghost:hover {
  background: var(--surface-muted);
  border-color: var(--border-strong);
}
.qr {
  display: block;
  margin: 0.5rem auto;
  padding: 0.5rem;
  border-radius: var(--radius-sm);
  background: var(--bg-warm);
}
.url {
  word-break: break-all;
  font-size: 0.85rem;
  font-family: ui-monospace, "SFMono-Regular", monospace;
  color: var(--text-muted);
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--bg-warm);
  border: 1px solid var(--border);
}
.error {
  color: var(--danger);
}
.hint {
  color: var(--text-muted);
  font-size: 0.8rem;
}
</style>
