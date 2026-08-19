<script setup lang="ts">
import { formatBytes, formatDate } from '../../lib/format'
import FileTypeIcon from '../FileTypeIcon.vue'
import type { FileItem } from '../FileList.vue'
import AppIcon from './AppIcon.vue'

defineProps<{ file: FileItem }>()
const emit = defineEmits<{ close: []; share: []; download: []; delete: [] }>()
</script>

<template>
  <Teleport to="body">
    <div
      class="sheet-overlay"
      @click.self="emit('close')"
    >
      <div
        class="sheet action-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="文件操作"
      >
        <div class="file-head">
          <span class="tile">
            <FileTypeIcon :mime="file.mimeType" />
          </span>
          <div class="file-body">
            <div class="file-name">
              {{ file.name }}
            </div>
            <div class="file-meta">
              {{ formatBytes(file.size) }} · {{ formatDate(file.createdAt) }}
            </div>
          </div>
        </div>

        <div class="actions">
          <button
            type="button"
            class="action-row"
            @click="emit('share')"
          >
            <AppIcon
              class="action-icon"
              name="share"
            />
            <span class="action-label">分享链接</span>
          </button>
          <button
            type="button"
            class="action-row"
            @click="emit('download')"
          >
            <AppIcon
              class="action-icon"
              name="download"
            />
            <span class="action-label">下载</span>
          </button>
          <button
            type="button"
            class="action-row danger"
            @click="emit('delete')"
          >
            <AppIcon
              class="action-icon"
              name="trash"
            />
            <span class="action-label">删除</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sheet-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: flex-end;
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
  padding: 0.625rem 0.875rem;
  border-bottom: 2px solid var(--drop-ink);
  background: var(--drop-surface-2);
}
.tile {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: var(--drop-card);
  color: var(--drop-ink-2);
}
.tile :deep(.file-icon) {
  width: 1.125rem;
  height: 1.125rem;
  border: 0;
  background: transparent;
  color: inherit;
}
.tile :deep(.file-icon svg) {
  width: 1rem;
  height: 1rem;
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

.actions {
  display: flex;
  flex-direction: column;
}
.action-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  padding: 0.75rem 0.875rem;
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
