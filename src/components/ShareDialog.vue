<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import QRCode from 'qrcode'

const dialogRef = ref<HTMLDivElement | null>(null)

import { api } from '../lib/api'
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
  // Move focus into the dialog so keyboard users land inside, not on the page.
  nextTick(() => dialogRef.value?.focus())
})
</script>

<template>
  <div
    class="overlay"
    @click.self="emit('close')"
  >
    <div
      ref="dialogRef"
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="分享文件"
      tabindex="-1"
      @keydown.esc="emit('close')"
    >
      <h3>分享 {{ file.name }}</h3>

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
            type="button"
            class="ghost"
            @click="emit('close')"
          >
            取消
          </button>
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
        <p
          class="ok"
          role="status"
        >
          分享已创建
        </p>
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
          有效期至 {{ new Date(result.expiresAt * 1000).toLocaleString() }}
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
        <p class="hint">
          链接已保存到分享页（本设备），关闭后仍可复制。
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.dialog {
  background: #fff;
  border-radius: var(--radius-md);
  padding: 1.25rem 1.5rem;
  max-width: 26rem;
  width: 90%;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
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
  padding: 0.35rem 0.5rem;
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
  padding: 0.4rem 0.9rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  cursor: pointer;
}
button[type='submit'] {
  background: var(--primary-dark);
  color: #fff;
  border-color: var(--primary);
}
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
.ok {
  color: var(--success);
}
.hint {
  color: var(--text-muted);
  font-size: 0.8rem;
}
</style>
