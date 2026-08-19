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
  background: rgba(15, 15, 18, 0.45);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: overlay-in 0.2s var(--drop-ease-spring);
}
@keyframes overlay-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.sheet {
  width: 100%;
  display: flex;
  flex-direction: column;
  border-top: 1px solid rgba(15, 15, 18, 0.08);
  border-radius: var(--drop-radius-xl) var(--drop-radius-xl) 0 0;
  background: var(--drop-card);
  box-shadow: var(--drop-shadow-4);
  padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
  animation: sheet-in 0.3s var(--drop-ease-spring);
}
@keyframes sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.file-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border-bottom: 1px solid var(--drop-line);
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
  box-shadow: inset 0 0 0 1px rgba(230, 57, 70, 0.08);
}
.tile :deep(.file-icon) {
  width: 1.375rem;
  height: 1.375rem;
  color: inherit;
}
.file-body {
  flex: 1;
  min-width: 0;
}
.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--drop-ink);
  letter-spacing: -0.01em;
}
.file-meta {
  margin-top: 0.125rem;
  font-size: 0.75rem;
  color: var(--drop-ink-3);
}

.actions {
  display: flex;
  flex-direction: column;
}
.action-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 1rem;
  border: 0;
  border-radius: 0;
  background: transparent;
  text-align: left;
  font: inherit;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--drop-dur-base) var(--drop-ease-spring);
}
.action-row + .action-row {
  border-top: 1px solid var(--drop-line);
}
.action-row:active {
  background: var(--drop-surface-2);
}
.action-icon {
  color: var(--drop-ink-2);
}
.action-label {
  flex: 1;
  font-size: 0.9375rem;
  color: var(--drop-ink);
  font-weight: 500;
  letter-spacing: -0.01em;
}
.action-row.danger .action-icon,
.action-row.danger .action-label {
  color: var(--drop-state-error);
}
</style>
