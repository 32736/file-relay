<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { formatBytes, formatDate } from '../../lib/format'
import { COPY } from '../../lib/copy'
import FileTypeIcon from '../FileTypeIcon.vue'
import type { FileItem } from '../FileList.vue'
import AppIcon from './AppIcon.vue'

defineProps<{ file: FileItem }>()
const emit = defineEmits<{ close: []; share: []; download: []; expiration: []; delete: [] }>()
const sheetDialog = ref<HTMLDialogElement | null>(null)
const sheetClose = ref<HTMLButtonElement | null>(null)
const returnFocus = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
  ? document.activeElement
  : null

function selectAction(action: 'share' | 'expiration' | 'download' | 'delete'): void {
  // Restore the row trigger before handing control to a follow-up dialog. That
  // dialog can then capture the stable row button instead of this sheet's
  // action button, which is about to be unmounted.
  if (returnFocus?.isConnected) returnFocus.focus()
  switch (action) {
    case 'share':
      emit('share')
      break
    case 'expiration':
      emit('expiration')
      break
    case 'download':
      emit('download')
      break
    case 'delete':
      emit('delete')
      break
  }
}

onMounted(() => {
  const dialog = sheetDialog.value
  if (!dialog) return
  try {
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  } catch {
    dialog.setAttribute('open', '')
  }
  void nextTick(() => sheetClose.value?.focus())
})

onBeforeUnmount(() => {
  if (returnFocus?.isConnected) returnFocus.focus()
})
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="sheetDialog"
      class="sheet-overlay"
      aria-labelledby="action-sheet-title"
      aria-describedby="action-sheet-file-meta"
      aria-modal="true"
      @cancel.prevent="emit('close')"
      @click.self="emit('close')"
    >
      <div
        class="sheet action-sheet"
      >
        <header class="file-head">
          <span class="tile">
            <FileTypeIcon :mime="file.mimeType" />
          </span>
          <div class="file-body">
            <h2
              id="action-sheet-title"
              class="file-name"
            >
              {{ file.name }}
            </h2>
            <div
              id="action-sheet-file-meta"
              class="file-meta"
            >
              {{ formatBytes(file.size) }} · {{ formatDate(file.createdAt) }}
            </div>
          </div>
          <button
            ref="sheetClose"
            type="button"
            class="sheet-close"
            :aria-label="COPY.actions.close"
            @click="emit('close')"
          >
            <AppIcon name="x" />
          </button>
        </header>

        <div class="actions">
          <button
            type="button"
            class="action-row"
            @click="selectAction('share')"
          >
            <AppIcon
              class="action-icon"
              name="share"
            />
            <span class="action-label">{{ COPY.actions.share }}链接</span>
          </button>
          <button
            type="button"
            class="action-row"
            @click="selectAction('expiration')"
          >
            <AppIcon
              class="action-icon"
              name="clock"
            />
            <span class="action-label">{{ COPY.actions.setFileRetention }}</span>
          </button>
          <button
            type="button"
            class="action-row"
            @click="selectAction('download')"
          >
            <AppIcon
              class="action-icon"
              name="download"
            />
            <span class="action-label">{{ COPY.actions.download }}</span>
          </button>
          <button
            type="button"
            class="action-row danger"
            @click="selectAction('delete')"
          >
            <AppIcon
              class="action-icon"
              name="trash"
            />
            <span class="action-label">删除</span>
          </button>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.sheet-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: flex-end;
  width: 100%;
  max-width: none;
  max-height: none;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  background: rgba(10, 10, 10, 0.55);
  animation: overlay-in 0.2s linear;
}
@keyframes overlay-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.sheet {
  width: 100%;
  display: flex;
  flex-direction: column;
  border-top: 2px solid var(--drop-ink);
  border-radius: 0;
  background: var(--drop-card);
  box-shadow: var(--drop-shadow-4);
  padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
  animation: sheet-in 0.25s var(--drop-ease-smooth);
}
@keyframes sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.file-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem var(--drop-mobile-gutter);
  border-bottom: 2px solid var(--drop-ink);
  background: var(--drop-surface-2);
}
.tile {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: var(--drop-card);
  color: var(--drop-ink-2);
}
.tile :deep(.file-icon) {
  width: 1rem;
  height: 1rem;
  border: 0;
  background: transparent;
  color: inherit;
}
.tile :deep(.file-icon svg) {
  width: 0.875rem;
  height: 0.875rem;
}
.file-body {
  flex: 1;
  min-width: 0;
}
.file-name {
  margin: 0;
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
.sheet-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: transparent;
  color: var(--drop-ink-2);
}
.sheet-close :deep(svg) {
  width: 1rem;
  height: 1rem;
}
.sheet-close:active {
  background: var(--drop-ink);
  color: var(--drop-background);
}

.actions {
  display: flex;
  flex-direction: column;
}
.action-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem var(--drop-mobile-gutter);
  border: 0;
  border-left: 4px solid transparent;
  border-radius: 0;
  background: transparent;
  text-align: left;
  font: inherit;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--drop-dur-fast) linear, border-color var(--drop-dur-fast) linear;
}
.action-row + .action-row {
  border-top: 1px solid var(--drop-line);
}
.action-row:active {
  background: var(--drop-surface-2);
  border-left-color: var(--drop-ink);
}
.action-icon {
  color: var(--drop-ink-2);
}
.action-label {
  flex: 1;
  font-family: var(--font-micro);
  font-size: 0.8rem;
  color: var(--drop-ink);
  font-weight: 700;
  letter-spacing: 0.06em;
}
.action-row.danger:active {
  border-left-color: var(--drop-state-error);
}
.action-row.danger .action-icon,
.action-row.danger .action-label {
  color: var(--drop-state-error);
}
</style>
