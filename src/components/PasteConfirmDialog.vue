<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { formatBytes } from '../lib/format'

const props = defineProps<{ files: File[] }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()

const dialogRef = ref<HTMLDialogElement | null>(null)
const confirmButton = ref<HTMLButtonElement | null>(null)
const previewFiles = computed(() => props.files.slice(0, 4))
const remainingCount = computed(() => Math.max(0, props.files.length - previewFiles.value.length))
const returnFocus = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
  ? document.activeElement
  : null

function close(): void {
  emit('cancel')
}

onMounted(() => {
  void nextTick(() => {
    const dialog = dialogRef.value
    if (!dialog || dialog.open) return
    try {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    } catch {
      dialog.setAttribute('open', '')
    }
    confirmButton.value?.focus()
  })
})

onBeforeUnmount(() => {
  if (returnFocus?.isConnected) returnFocus.focus()
})
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="dialog paste-confirm-dialog"
      aria-labelledby="paste-confirm-title"
      aria-describedby="paste-confirm-description"
      aria-modal="true"
      @cancel.prevent="close"
      @click.self="close"
    >
      <p class="paste-confirm-kicker">
        CLIPBOARD / FILES
      </p>
      <h2
        id="paste-confirm-title"
        class="paste-confirm-title"
      >
        确认上传剪贴板文件？
      </h2>
      <p
        id="paste-confirm-description"
        class="paste-confirm-description"
      >
        检测到 {{ files.length }} 个文件，确认后才会开始上传。
      </p>

      <ul class="paste-file-list">
        <li
          v-for="file in previewFiles"
          :key="`${file.name}-${file.size}-${file.lastModified}`"
        >
          <span class="paste-file-name">{{ file.name }}</span>
          <span class="paste-file-size">{{ formatBytes(file.size) }}</span>
        </li>
      </ul>
      <p
        v-if="remainingCount > 0"
        class="paste-more"
      >
        另有 {{ remainingCount }} 个文件未展开
      </p>

      <div class="paste-confirm-actions">
        <button
          type="button"
          class="ghost"
          @click="close"
        >
          取消
        </button>
        <button
          ref="confirmButton"
          type="button"
          class="btn-primary"
          autofocus
          @click="emit('confirm')"
        >
          确认上传
        </button>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.paste-confirm-dialog {
  margin: auto;
  width: min(30rem, calc(100vw - 2rem));
  max-width: 30rem;
  border: 2px solid var(--drop-ink);
  border-top: 6px solid var(--drop-brand);
  border-radius: 0;
  background: var(--drop-card);
  color: var(--drop-ink-2);
  padding: 1.25rem;
  box-shadow: var(--drop-shadow-hard);
}

.paste-confirm-kicker {
  margin: 0 0 0.55rem;
  color: var(--drop-brand);
  font-family: var(--font-micro);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.14em;
}

.paste-confirm-title {
  margin: 0;
  padding-bottom: 0.75rem;
  border-bottom: 2px solid var(--drop-ink);
  color: var(--drop-ink);
  font-family: var(--font-micro);
  font-size: 1rem;
  line-height: 1.45;
}

.paste-confirm-title::before {
  content: "[ ";
  color: var(--drop-brand);
}

.paste-confirm-title::after {
  content: " ]";
  color: var(--drop-brand);
}

.paste-confirm-description {
  margin: 1rem 0 0.75rem;
  color: var(--drop-ink-3);
  font-size: 0.82rem;
  line-height: 1.6;
}

.paste-file-list {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding: 0.65rem 0.75rem;
  border: 1px dashed var(--drop-line);
  background: var(--drop-surface-muted);
  list-style: none;
}

.paste-file-list li {
  display: flex;
  min-width: 0;
  gap: 0.75rem;
  align-items: baseline;
  justify-content: space-between;
  color: var(--drop-ink-2);
  font-family: var(--font-micro);
  font-size: 0.75rem;
}

.paste-file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.paste-file-size,
.paste-more {
  flex: none;
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: 0.68rem;
}

.paste-more {
  margin: 0.45rem 0 0;
}

.paste-confirm-actions {
  display: flex;
  gap: 0.6rem;
  justify-content: flex-end;
  margin-top: 1.1rem;
}

.paste-confirm-actions button {
  min-width: 6.25rem;
  min-height: 2.75rem;
}

@media (max-width: 480px) {
  .paste-confirm-dialog {
    margin: auto 0 0;
    width: 100%;
    max-width: none;
    padding: 1.25rem 1rem calc(1.25rem + env(safe-area-inset-bottom, 0px));
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    box-shadow: 0 -4px 0 var(--drop-ink);
  }

  .paste-confirm-actions {
    display: grid;
    grid-template-columns: 1fr 1.2fr;
  }
}
</style>
