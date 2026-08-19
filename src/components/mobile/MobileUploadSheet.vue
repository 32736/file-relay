<script setup lang="ts">
import { computed, ref } from 'vue'

import UploadZone from '../UploadZone.vue'
import type { UploadTask } from '../../composables/useUploads'
import AppIcon from './AppIcon.vue'

const emit = defineEmits<{ close: []; uploaded: [] }>()

const uploadZone = ref<InstanceType<typeof UploadZone> | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)
const videoInput = ref<HTMLInputElement | null>(null)

const tasks = computed<UploadTask[]>(() => uploadZone.value?.tasks ?? [])

const uploadingCount = computed(
  () => tasks.value.filter((task) => task.status === 'uploading' || task.status === 'queued').length,
)
const completedCount = computed(
  () => tasks.value.filter((task) => task.status === 'completed').length,
)
const busy = computed(() => uploadingCount.value > 0)

function addFiles(files: File[]): void {
  uploadZone.value?.addFiles(files)
}

function onPickFiltered(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length > 0) addFiles(files)
}

defineExpose({ addFiles })
</script>

<template>
  <Teleport to="body">
    <div
      class="sheet-overlay"
      @click.self="emit('close')"
    >
      <div
        class="sheet upload-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="上传文件"
      >
        <div class="sheet-handle" />
        <div class="sheet-head">
          <span class="sheet-title">{{ busy ? '上传中' : '上传文件' }}</span>
          <button
            type="button"
            class="sheet-close"
            aria-label="关闭"
            @click="emit('close')"
          >
            <AppIcon name="x" />
          </button>
        </div>

        <div class="sheet-body">
          <UploadZone
            ref="uploadZone"
            class="mobile-uploads"
            no-drag
            @uploaded="emit('uploaded')"
          />

          <div class="pick-grid">
            <button
              type="button"
              @click="imageInput?.click()"
            >
              <AppIcon name="image" />
              <span>选择图片</span>
            </button>
            <button
              type="button"
              @click="videoInput?.click()"
            >
              <AppIcon name="film" />
              <span>选择视频</span>
            </button>
          </div>
          <input
            ref="imageInput"
            type="file"
            accept="image/*"
            multiple
            hidden
            @change="onPickFiltered"
          >
          <input
            ref="videoInput"
            type="file"
            accept="video/*"
            multiple
            hidden
            @change="onPickFiltered"
          >
        </div>

        <div
          v-if="tasks.length"
          class="sheet-summary"
        >
          <span class="summary-text">
            {{ uploadingCount ? `${uploadingCount} 个文件上传中` : '全部完成' }}<template v-if="completedCount"> · {{ completedCount }} 个完成</template>
          </span>
          <button
            type="button"
            class="summary-done"
            @click="emit('close')"
          >
            完成
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
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
}

.sheet {
  width: 100%;
  max-height: calc(100dvh - 64px);
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--drop-border);
  border-radius: var(--drop-radius-lg) var(--drop-radius-lg) 0 0;
  background: var(--drop-card);
  box-shadow: var(--drop-shadow-3);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.sheet-handle {
  width: 2.5rem;
  height: 0.25rem;
  margin: 0.75rem auto 0;
  border-radius: var(--drop-radius-pill);
  background: var(--drop-line);
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem 0.5rem;
}
.sheet-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--drop-ink);
}
.sheet-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: 0;
  border-radius: var(--drop-radius-sm);
  background: transparent;
  color: var(--drop-ink-2);
}
.sheet-close:active {
  background: var(--drop-surface-2);
}
.sheet-body {
  min-height: 0;
  overflow-y: auto;
  padding: 0.25rem 1rem 1rem;
}

/* Restyle the desktop UploadZone to the mobile sheet look. */
.mobile-uploads :deep(.drop-area) {
  border: 0.125rem dashed var(--drop-border);
  border-radius: var(--drop-radius-md);
  background: var(--drop-surface-2);
  box-shadow: none;
  padding: 1.5rem 1rem;
  gap: 0.5rem;
}
.mobile-uploads :deep(.drop-area:hover),
.mobile-uploads :deep(.dragging .drop-area) {
  border-style: dashed;
  border-color: var(--drop-brand);
  background: var(--drop-brand-tint);
  box-shadow: none;
  transform: none;
}
.mobile-uploads :deep(.drop-title) {
  font-size: 0.9375rem;
  font-weight: 500;
}
.mobile-uploads :deep(.drop-sub) {
  font-size: 0.75rem;
  color: var(--drop-ink-3);
}
.mobile-uploads :deep(.tasks) {
  margin-top: 0.75rem;
  gap: 0;
}
.mobile-uploads :deep(.task) {
  border: 0;
  border-top: 1px solid var(--drop-line);
  border-radius: 0;
  background: transparent;
  padding: 0.75rem 0;
}
.mobile-uploads :deep(.task:first-child) {
  border-top: 0;
}
.mobile-uploads :deep(.name) {
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--drop-ink);
}
.mobile-uploads :deep(.meta),
.mobile-uploads :deep(.status) {
  font-size: 0.75rem;
  color: var(--drop-ink-3);
}
.mobile-uploads :deep(.bar) {
  background: var(--drop-muted);
  border-radius: var(--drop-radius-pill);
}
.mobile-uploads :deep(.fill) {
  background: var(--drop-brand);
}
.mobile-uploads :deep(.actions button) {
  border-color: var(--drop-border);
  border-radius: var(--drop-radius-sm);
  color: var(--drop-ink-2);
  background: var(--drop-card);
}

.pick-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.pick-grid button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 2.75rem;
  border: 1px solid var(--drop-border);
  border-radius: var(--drop-radius-md);
  background: var(--drop-card);
  color: var(--drop-ink);
  font-size: 0.875rem;
  font-weight: 500;
}
.pick-grid button:active {
  background: var(--drop-surface-2);
}

.sheet-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--drop-line);
}
.summary-text {
  font-size: 0.8125rem;
  color: var(--drop-ink-2);
}
.summary-done {
  min-height: 2.5rem;
  padding: 0 1.375rem;
  border: 0;
  border-radius: var(--drop-radius-md);
  background: var(--drop-brand);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 600;
}
.summary-done:active {
  background: var(--drop-brand-strong);
}
</style>
