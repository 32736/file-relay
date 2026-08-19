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
  border: 2px solid var(--text);
  border-radius: var(--radius-md);
  padding: 1.25rem 1.5rem;
  max-width: 26rem;
  width: 90%;
  box-shadow: var(--shadow-hard);
}
.dialog::backdrop {
  background: rgba(24, 26, 25, 0.52);
}
.dialog-title {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text);
  overflow: hidden;
}
.title-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
label {
  display: block;
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
}
label input[type='number'],
label input[type='password'] {
  display: block;
  width: 100%;
  margin-top: 0.25rem;
  min-height: 2.5rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.check {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}
.buttons {
  display: flex;
  gap: 0.6rem;
  justify-content: flex-end;
  margin-top: 0.75rem;
}
button {
  min-height: 2.5rem;
  padding: 0.45rem 0.9rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  cursor: pointer;
}
button[type='submit'] {
  background: var(--primary);
  color: #fff;
  border: 2px solid var(--text);
  box-shadow: var(--shadow-hard-sm);
}
button[type='submit']:not(:disabled):hover { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--text); background: var(--primary-dark); }
button.ghost {
  background: transparent;
}
.qr {
  display: block;
  margin: 0.5rem auto;
}
.url {
  word-break: break-all;
  font-size: 0.85rem;
}
.error {
  color: var(--danger);
}
.hint {
  color: var(--text-muted);
  font-size: 0.8rem;
}
</style>
