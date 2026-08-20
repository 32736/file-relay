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
  background: rgba(10, 10, 10, 0.55);
  animation: overlay-in 0.2s linear;
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
  border-top: 2px solid var(--drop-ink);
  border-radius: 0;
  background: var(--drop-card);
  box-shadow: var(--drop-shadow-4);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  animation: sheet-in 0.25s var(--drop-ease-smooth);
}
@keyframes sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
.sheet-handle {
  width: 2rem;
  height: 0.375rem;
  margin: 0.375rem auto 0;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: var(--drop-surface-2);
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.375rem 0.75rem 0.25rem;
  border-bottom: 2px solid var(--drop-ink);
}
.sheet-title {
  font-family: var(--font-micro);
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--drop-ink);
}
.sheet-title::before {
  content: "[ ";
  color: var(--drop-brand);
}
.sheet-title::after {
  content: " ]";
  color: var(--drop-brand);
}
.sheet-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: transparent;
  color: var(--drop-ink-2);
  transition: background-color var(--drop-dur-fast) linear, color var(--drop-dur-fast) linear;
}
.sheet-close:active {
  background: var(--drop-ink);
  color: var(--drop-background);
}
.sheet-body {
  min-height: 0;
  overflow-y: auto;
  padding: 0.75rem;
}

.mobile-uploads :deep(.drop-area) {
  border: 2px dashed var(--drop-ink);
  border-radius: 0;
  background: var(--drop-surface-2);
  box-shadow: none;
  padding: 0.875rem 0.75rem;
  gap: 0.375rem;
  transition: border-color var(--drop-dur-fast) linear, background-color var(--drop-dur-fast) linear;
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
  font-family: var(--font-micro);
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.mobile-uploads :deep(.drop-sub) {
  font-family: var(--font-micro);
  font-size: 0.6875rem;
  color: var(--drop-ink-3);
}
.mobile-uploads :deep(.tasks) {
  margin-top: 0.5rem;
  gap: 0;
}
.mobile-uploads :deep(.task) {
  border: 0;
  border-top: 1px solid var(--drop-line);
  border-left: 4px solid transparent;
  border-radius: 0;
  background: transparent;
  padding: 0.5rem 0 0.5rem 0.5rem;
  box-shadow: none;
}
.mobile-uploads :deep(.task:first-child) {
  border-top: 0;
}
.mobile-uploads :deep(.task.completed) {
  border-left-color: var(--drop-state-success);
}
.mobile-uploads :deep(.task.failed) {
  border-left-color: var(--drop-state-error);
}
.mobile-uploads :deep(.name) {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--drop-ink);
}
.mobile-uploads :deep(.meta),
.mobile-uploads :deep(.status) {
  font-family: var(--font-micro);
  font-size: 0.66rem;
  color: var(--drop-ink-3);
}
.mobile-uploads :deep(.bar) {
  background: var(--drop-muted);
  border: 1px solid var(--drop-line);
  border-radius: 0;
}
.mobile-uploads :deep(.fill) {
  background: var(--drop-brand);
}
.mobile-uploads :deep(.actions button) {
  border-color: var(--drop-ink);
  border-radius: 0;
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
  gap: 0.375rem;
  min-height: 2.25rem;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: var(--drop-card);
  color: var(--drop-ink);
  font-family: var(--font-micro);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  box-shadow: var(--drop-shadow-1);
  transition: background-color var(--drop-dur-fast) linear, color var(--drop-dur-fast) linear, transform var(--drop-dur-fast) linear, box-shadow var(--drop-dur-fast) linear;
}
.pick-grid button:active {
  background: var(--drop-ink);
  color: var(--drop-background);
  transform: translate(2px, 2px);
  box-shadow: 0 0 0 #000000;
}

.sheet-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  border-top: 2px solid var(--drop-ink);
  background: var(--drop-surface-2);
}
.summary-text {
  font-family: var(--font-micro);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--drop-ink-2);
}
.summary-done {
  min-height: 2rem;
  padding: 0 0.875rem;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: var(--drop-brand);
  color: #fff;
  font-family: var(--font-micro);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  box-shadow: var(--drop-shadow-1);
  transition: transform var(--drop-dur-fast) linear, box-shadow var(--drop-dur-fast) linear;
}
.summary-done:active {
  transform: translate(2px, 2px);
  box-shadow: 0 0 0 #000000;
}
</style>
