<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import QRCode from 'qrcode'

import { api } from '../lib/api'
import type { FileItem } from './FileList.vue'

const props = defineProps<{ file: FileItem }>()
const emit = defineEmits<{ close: []; shared: [] }>()

interface ShareResult {
  id: string
  url: string
  expiresAt: number | null
  maxDownloads: number | null
  deleteFileAfterExhausted: boolean
  passwordProtected: boolean
}

const expiresHours = ref<number | null>(null)
const maxDownloads = ref<number | null>(null)
const password = ref('')
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
    if (password.value) body.password = password.value
    if (burnAfterReading.value) {
      body.maxDownloads = 1
      body.deleteFileAfterExhausted = true
    }
    result.value = await api<ShareResult>(`/api/files/${props.file.id}/shares`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
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
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

function sharePath(): string {
  if (!result.value) return ''
  const token = result.value.url.split('/s/')[1]
  return `/s/${token}`
}

onMounted(() => undefined)
</script>

<template>
  <div
    class="overlay"
    @click.self="emit('close')"
  >
    <div
      class="dialog"
      role="dialog"
      aria-label="分享文件"
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
        <label>
          访问密码（可选）
          <input
            v-model="password"
            type="password"
            autocomplete="new-password"
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
          v-if="result.passwordProtected"
          class="hint"
        >
          此分享受密码保护。
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
          本页下载地址：{{ sharePath() }}
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
  border-radius: 10px;
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
  border-radius: 5px;
  border: 1px solid var(--border, #ccc);
  cursor: pointer;
}
button[type='submit'] {
  background: var(--accent, #3b82f6);
  color: #fff;
  border-color: var(--accent, #3b82f6);
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
  color: #dc2626;
}
.ok {
  color: #16a34a;
}
.hint {
  color: #777;
  font-size: 0.8rem;
}
</style>
