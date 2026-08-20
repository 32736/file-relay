<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { api, getUserErrorMessage } from '../lib/api'
import { COPY, formatFileRetention } from '../lib/copy'
import { formatDate } from '../lib/format'
import { toast } from '../lib/toast'
import type { FileItem } from './FileList.vue'

const props = defineProps<{ file: FileItem }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const expirationSelect = ref<HTMLSelectElement | null>(null)
const errorMessage = ref<HTMLElement | null>(null)
const saving = ref(false)
const error = ref<string | null>(null)
const selected = ref<number | null>(props.file.expiresAt === null ? null : 30 * 24 * 60 * 60)
const returnFocus = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
  ? document.activeElement
  : null

onMounted(() => {
  void nextTick(() => {
    try {
      dialog.value?.showModal()
    } catch {
      dialog.value?.setAttribute('open', '')
    }
    expirationSelect.value?.focus()
  })
})

onBeforeUnmount(() => {
  if (returnFocus?.isConnected) returnFocus.focus()
})

async function save(): Promise<void> {
  if (saving.value) return
  saving.value = true
  error.value = null
  try {
    await api(`/api/files/${props.file.id}/expiration`, {
      method: 'PATCH',
      headers: { Origin: window.location.origin },
      body: JSON.stringify({ expiresIn: selected.value }),
    })
    toast(selected.value === null ? '文件已设置为永久保存' : '文件保存期限已更新', 'success')
    emit('saved')
  } catch (cause) {
    error.value = getUserErrorMessage(cause, COPY.errors.expiration)
    toast(error.value, 'error')
    await nextTick()
    errorMessage.value?.focus()
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="expiration-dialog"
      aria-labelledby="expiration-title"
      aria-describedby="expiration-description"
      aria-modal="true"
      @cancel.prevent="emit('close')"
      @click.self="emit('close')"
    >
      <h2 id="expiration-title">
        {{ COPY.actions.setFileRetention }}
      </h2>
      <p class="expiration-file">
        {{ file.name }}
      </p>
      <p
        id="expiration-description"
        class="expiration-current"
      >
        当前：{{ formatFileRetention(file.expiresAt, formatDate) }}
      </p>
      <form
        class="expiration-form"
        :aria-busy="saving"
        @submit.prevent="save"
      >
        <label
          class="expiration-field"
          for="expiration-select"
        >
          <span>新的期限</span>
          <select
            id="expiration-select"
            ref="expirationSelect"
            v-model="selected"
            name="expiresIn"
            :aria-describedby="error ? 'expiration-error' : undefined"
            :aria-invalid="error ? 'true' : undefined"
            @change="error = null"
          >
            <option :value="7 * 24 * 60 * 60">7 天</option>
            <option :value="30 * 24 * 60 * 60">30 天</option>
            <option :value="90 * 24 * 60 * 60">90 天</option>
            <option :value="365 * 24 * 60 * 60">1 年</option>
            <option :value="null">永久</option>
          </select>
        </label>
        <p
          v-if="error"
          id="expiration-error"
          ref="errorMessage"
          class="expiration-error"
          role="alert"
          aria-atomic="true"
          tabindex="-1"
        >
          {{ error }}
        </p>
        <div class="expiration-actions">
          <button
            type="button"
            class="btn-secondary"
            @click="emit('close')"
          >
            {{ COPY.actions.cancel }}
          </button>
          <button
            type="submit"
            class="btn-primary"
            :disabled="saving"
          >
            {{ saving ? '保存中…' : COPY.actions.save }}
          </button>
        </div>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.expiration-dialog {
  width: min(28rem, calc(100vw - 2rem));
  padding: 1.25rem;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: var(--drop-card);
  color: var(--drop-ink);
  box-shadow: var(--drop-shadow-4);
}
.expiration-dialog::backdrop { background: rgba(10, 10, 10, 0.55); }
.expiration-dialog h2 {
  margin: 0;
  font-family: var(--font-macro);
  font-size: 1.15rem;
}
.expiration-file {
  margin: 0.9rem 0 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}
.expiration-current {
  margin: 0 0 1rem;
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: 0.75rem;
}
.expiration-error {
  margin: 0.75rem 0 0;
  color: var(--drop-state-error);
  font-family: var(--font-micro);
  font-size: 0.78rem;
}
.expiration-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  font-family: var(--font-micro);
  font-size: 0.8rem;
}
.expiration-field select {
  min-height: 2.25rem;
  padding: 0 0.6rem;
  border: 1px solid var(--drop-line);
  border-radius: 0;
  background: var(--drop-surface);
  color: var(--drop-ink);
  font: inherit;
}
.expiration-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.25rem;
}
.expiration-actions button {
  min-height: 2.25rem;
  padding: 0 0.9rem;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  font-family: var(--font-micro);
  font-weight: 700;
}
.btn-secondary { background: transparent; color: var(--drop-ink-2); }
.btn-primary { background: var(--drop-brand); color: var(--drop-background); }
.btn-primary:disabled { opacity: 0.6; }
</style>
