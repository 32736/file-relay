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
/* All colours go through drop-* tokens so the dialog reads correctly in both
   the light (newspaper white + charcoal) and dark (CRT phosphor) themes. */
.dialog {
  margin: auto;
  background: var(--drop-card);
  border: 2px solid var(--drop-ink);
  border-top: 6px solid var(--drop-brand);
  border-radius: 0;
  padding: 1.5rem 1.75rem;
  max-width: 26rem;
  width: 90%;
  box-shadow: var(--drop-shadow-hard);
  color: var(--drop-ink-2);
  animation: dialog-in 0.2s var(--drop-ease-smooth);
}
@keyframes dialog-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.dialog::backdrop {
  /* A fully neutral dim layer that reads the same in light and dark. */
  background: color-mix(in srgb, var(--drop-ink) 56%, transparent);
}
.dialog-title {
  margin: 0 0 1.1rem;
  padding-bottom: 0.7rem;
  border-bottom: 2px solid var(--drop-ink);
  font-family: var(--font-micro);
  font-size: 0.82rem;
  font-weight: 700;
  line-height: 1.45;
  letter-spacing: 0.05em;
  color: var(--drop-ink);
  overflow: hidden;
}
.dialog-title::before {
  content: ">> ";
  color: var(--drop-brand);
}
.title-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
label {
  display: block;
  margin-bottom: 0.9rem;
  font-family: var(--font-micro);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--drop-ink-3);
}
label input[type='number'],
label input[type='password'] {
  display: block;
  width: 100%;
  margin-top: 0.4rem;
  min-height: 2.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: var(--drop-surface);
  color: var(--drop-ink);
  font-family: var(--font-micro);
  font-size: 0.9rem;
}
label input[type='number']::placeholder,
label input[type='password']::placeholder {
  color: var(--drop-ink-3);
}
label input[type='number']:focus,
label input[type='password']:focus {
  outline: none;
  border: 2px solid var(--drop-brand);
  padding: calc(0.5rem - 1px) calc(0.75rem - 1px);
}
.check {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  padding: 0.75rem;
  border: 1px dashed var(--drop-line);
  border-radius: 0;
  background: var(--drop-surface-muted);
  color: var(--drop-ink-2);
}
.check input[type='checkbox'] {
  accent-color: var(--drop-brand);
}
.buttons {
  display: flex;
  gap: 0.6rem;
  justify-content: flex-end;
  margin-top: 1.1rem;
}
button {
  min-height: 2.75rem;
  padding: 0.5rem 1rem;
  border-radius: 0;
  border: 1px solid var(--drop-ink);
  background: var(--drop-surface);
  color: var(--drop-ink);
  cursor: pointer;
}
button[type='submit'] {
  background: var(--drop-brand);
  color: var(--drop-background);
  border-color: var(--drop-ink);
  font-family: var(--font-micro);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  box-shadow: var(--drop-shadow-hard-sm);
}
button[type='submit']:not(:disabled):hover {
  filter: brightness(1.08);
  transform: translate(-1px, -1px);
  box-shadow: 4px 4px 0 var(--drop-ink);
}
button[type='submit']:not(:disabled):active {
  transform: translate(3px, 3px);
  box-shadow: 0 0 0 var(--drop-ink);
}
button.ghost {
  font-family: var(--font-micro);
  font-weight: 700;
  letter-spacing: 0.08em;
}
button.ghost:hover {
  background: var(--drop-ink);
  color: var(--drop-background);
}
/* QR codes must stay on a white page — the outer frame uses theme tokens so
   the box blends with the dialog in light *and* dark. */
.qr {
  display: block;
  margin: 0.5rem auto;
  padding: 0.5rem;
  border: 1px solid var(--drop-ink);
  background: #FFFFFF;
  box-shadow: inset 0 0 0 3px var(--drop-surface);
}
.url {
  word-break: break-all;
  font-size: 0.8rem;
  font-family: var(--font-micro);
  color: var(--drop-ink);
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--drop-ink);
  border-left: 4px solid var(--drop-brand);
  background: var(--drop-surface);
}
.error {
  color: var(--drop-brand);
  font-family: var(--font-micro);
  font-size: 0.8rem;
}
.hint {
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: 0.75rem;
  letter-spacing: 0.05em;
}
</style>
