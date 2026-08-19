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
  max-height: calc(100dvh - 64px);
  display: flex;
  flex-direction: column;
  border-top: 1px solid rgba(15, 15, 18, 0.08);
  border-radius: var(--drop-radius-xl) var(--drop-radius-xl) 0 0;
  background: var(--drop-card);
  box-shadow: var(--drop-shadow-4);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  animation: sheet-in 0.3s var(--drop-ease-spring);
}
@keyframes sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
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
  letter-spacing: -0.02em;
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
  transition: background-color var(--drop-dur-base) var(--drop-ease-spring);
}
.sheet-close:active {
  background: var(--drop-surface-2);
}
.sheet-body {
  min-height: 0;
  overflow-y: auto;
  padding: 0.25rem 1rem 1rem;
}

.mobile-uploads :deep(.drop-area) {
  border: 1.5px dashed var(--drop-border);
  border-radius: var(--drop-radius-md);
  background: var(--drop-surface-2);
  box-shadow: none;
  padding: 1.5rem 1rem;
  gap: 0.5rem;
  transition: border-color var(--drop-dur-base) var(--drop-ease-spring), background-color var(--drop-dur-base) var(--drop-ease-spring);
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
  font-weight: 600;
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
  box-shadow: none;
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
  background: linear-gradient(90deg, var(--drop-brand) 0%, var(--drop-brand-strong) 100%);
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
  min-height: 3rem;
  border: 1px solid rgba(15, 15, 18, 0.08);
  border-radius: var(--drop-radius-md);
  background: var(--drop-card);
  color: var(--drop-ink);
  font-size: 0.875rem;
  font-weight: 500;
  transition: border-color var(--drop-dur-base) var(--drop-ease-spring), background-color var(--drop-dur-base) var(--drop-ease-spring);
}
.pick-grid button:active {
  background: var(--drop-surface-2);
  border-color: var(--drop-brand);
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
  font-weight: 500;
}
.summary-done {
  min-height: 2.5rem;
  padding: 0 1.375rem;
  border: 0;
  border-radius: var(--drop-radius-md);
  background: linear-gradient(135deg, var(--drop-brand) 0%, var(--drop-brand-strong) 100%);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 600;
  box-shadow: 0 4px 14px -2px rgba(230, 57, 70, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.15);
  transition: filter var(--drop-dur-base) var(--drop-ease-spring), transform var(--drop-dur-base) var(--drop-ease-spring);
}
.summary-done:active {
  filter: brightness(0.96);
  transform: scale(0.98);
}
</style>
