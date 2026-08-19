<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useUploads, type UploadTask } from '../composables/useUploads'
import { formatBytes } from '../lib/format'
import { toast } from '../lib/toast'

const props = defineProps<{ compact?: boolean; noDrag?: boolean }>()
const emit = defineEmits<{ uploaded: [] }>()

const { tasks, addFiles, pause, resume, cancel, retry, restore, hasFile } = useUploads(() =>
  emit('uploaded'),
)

const dragging = ref(false)
const speeds = ref<Record<string, number>>({})
const lastBytes = new Map<string, number>()
const pickInput = ref<HTMLInputElement | null>(null)

let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  void restore()
  // Per-task transfer speed sampled once per second.
  timer = setInterval(() => {
    const next: Record<string, number> = {}
    for (const task of tasks.value) {
      if (task.status !== 'uploading') {
        next[task.uploadId] = 0
        continue
      }
      const previous = lastBytes.get(task.uploadId) ?? task.transferred
      next[task.uploadId] = Math.max(0, task.transferred - previous)
      lastBytes.set(task.uploadId, task.transferred)
    }
    speeds.value = next
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

// Notify on new completions.
const seenCompleted = new Set<string>()
watch(
  () => tasks.value.filter((task) => task.status === 'completed').map((task) => task.uploadId),
  (ids) => {
    for (const id of ids) {
      if (!seenCompleted.has(id)) {
        seenCompleted.add(id)
        const task = tasks.value.find((item) => item.uploadId === id)
        if (task) toast(`已上传：${task.name}`, 'success')
      }
    }
  },
)

function percent(task: UploadTask): number {
  return task.size > 0 ? Math.min(100, Math.round((task.transferred / task.size) * 100)) : 0
}

function etaSeconds(task: UploadTask): number {
  const speed = speeds.value[task.uploadId] ?? 0
  if (speed <= 0) return 0
  return Math.max(1, Math.ceil((task.size - task.transferred) / speed))
}

function statusLabel(task: UploadTask): string {
  switch (task.status) {
    case 'queued':
      return '排队中'
    case 'uploading':
      return '上传中'
    case 'paused':
      return hasFile(task.uploadId) ? '已暂停' : '已暂停（需重新选择文件）'
    case 'completed':
      return '完成'
    case 'canceled':
      return '已取消'
    case 'failed':
      return '失败'
  }
}

async function handleFiles(files: File[]): Promise<void> {
  if (files.length === 0) return
  addFiles(files)
}

function onDragEnter(): void {
  if (props.noDrag) return
  dragging.value = true
}

function onDragOver(): void {
  if (props.noDrag) return
  dragging.value = true
}

function onDragLeave(): void {
  if (props.noDrag) return
  dragging.value = false
}

function onDrop(event: DragEvent): void {
  if (props.noDrag) return
  dragging.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  void handleFiles(files)
}

function onPickFiles(event: Event): void {
  const files = Array.from((event.target as HTMLInputElement).files ?? [])
  void handleFiles(files)
  ;(event.target as HTMLInputElement).value = ''
}

function pickForResume(): void {
  pickInput.value?.click()
}

function onPickResume(event: Event): void {
  const files = Array.from((event.target as HTMLInputElement).files ?? [])
  ;(event.target as HTMLInputElement).value = ''
  if (files.length > 0) void handleFiles(files)
}

defineExpose({ addFiles, tasks })
</script>

<template>
  <section
    class="upload-zone"
    :class="{ dragging }"
  >
    <div
      class="drop-area"
      :class="{ compact }"
      role="button"
      tabindex="0"
      @dragenter.prevent.stop="onDragEnter"
      @dragover.prevent.stop="onDragOver"
      @dragleave.prevent.stop="onDragLeave"
      @drop.prevent.stop="onDrop"
      @keydown.enter.prevent="pickInput?.click()"
      @click="pickInput?.click()"
    >
      <p class="drop-title">
        选择文件上传
      </p>
      <p class="drop-sub">
        <template v-if="noDrag">
          单文件最大 2 GB
        </template>
        <template v-else>
          也可拖入页面任意位置 · 单文件最大 2 GB
        </template>
      </p>
      <input
        ref="pickInput"
        class="standalone-input"
        type="file"
        multiple
        @change="onPickFiles"
      >
    </div>

    <ul
      v-if="tasks.length"
      class="tasks"
      aria-label="上传队列"
    >
      <li
        v-for="task in tasks"
        :key="task.uploadId"
        class="task"
        :class="task.status"
      >
        <div class="row">
          <span
            v-if="task.status === 'completed'"
            class="done-dot"
            aria-hidden="true"
          />
          <span class="name">{{ task.name }}</span>
          <span class="meta">{{ formatBytes(task.size) }}</span>
          <span class="status">{{ statusLabel(task) }}</span>
        </div>
        <div class="progress-row">
          <span
            v-if="task.status === 'uploading'"
            class="progress-info"
          >
            {{ percent(task) }}% · {{ formatBytes(speeds[task.uploadId] ?? 0) }}/s
            <template v-if="speeds[task.uploadId] && task.transferred < task.size">
              · 剩余约 {{ etaSeconds(task) }} 秒
            </template>
          </span>
          <span
            v-else-if="task.status === 'failed'"
            class="progress-info error"
            role="alert"
          >
            {{ task.error }}
          </span>
          <span
            v-else-if="task.status === 'paused' && !hasFile(task.uploadId)"
            class="progress-info"
          >
            刷新后需重新选择同一文件
          </span>
          <span
            v-else
            class="progress-info"
          >
            {{ percent(task) }}%
          </span>
          <div
            class="bar"
            aria-hidden="true"
          >
            <div
              class="fill"
              :style="{ '--progress': percent(task) / 100 }"
              aria-hidden="true"
            />
          </div>
          <div class="actions">
            <button
              v-if="task.status === 'uploading'"
              type="button"
              @click="pause(task.uploadId)"
            >
              暂停
            </button>
            <button
              v-else-if="task.status === 'paused' && hasFile(task.uploadId)"
              type="button"
              @click="resume(task.uploadId)"
            >
              继续
            </button>
            <button
              v-else-if="task.status === 'paused' && !hasFile(task.uploadId)"
              type="button"
              @click="pickForResume"
            >
              选择文件续传
            </button>
            <button
              v-if="task.status === 'failed' || task.status === 'canceled'"
              type="button"
              @click="retry(task.uploadId)"
            >
              重试
            </button>
            <button
              v-if="task.status !== 'completed' && task.status !== 'canceled'"
              type="button"
              class="danger"
              @click="cancel(task.uploadId)"
            >
              取消
            </button>
          </div>
        </div>
      </li>
    </ul>

    <input
      ref="pickInput"
      type="file"
      class="hidden-input"
      multiple
      @change="onPickResume"
    >
  </section>
</template>

<style scoped>
.upload-zone .drop-area {
  position: relative;
  border: 2px dashed var(--text);
  border-radius: var(--radius-lg);
  padding: 2.75rem 1.5rem 2.25rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  background: var(--surface);
  box-shadow: inset 0 -4px 0 var(--surface-muted);
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.15s ease;
}
.upload-zone .drop-area:hover,
.upload-zone.dragging .drop-area {
  border-style: solid;
  border-color: var(--text);
  background: var(--bg-warm);
  box-shadow: var(--shadow-hard-sm), inset 0 -4px 0 var(--primary);
  transform: translate(-1px, -1px);
}
.drop-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--text);
}
/* Compact when files already exist: smaller area, art hidden */
.upload-zone .drop-area.compact {
  padding: 1.1rem 1rem;
  flex-direction: column;
  justify-content: center;
  gap: 0.25rem;
}
.upload-zone .drop-area.compact .drop-title {
  font-size: 1rem;
}
.drop-sub {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
}
.standalone-input {
  display: none;
}
.tasks {
  list-style: none;
  margin: 0.75rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.task {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.75rem 0.9rem;
  background: var(--surface);
}
.task.completed {
  opacity: 0.85;
}
/* Drop-ripple completion mark: the dot lands and ripples once. */
.done-dot {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  background: var(--success);
  position: relative;
  flex: none;
}
@media (prefers-reduced-motion: no-preference) {
  .done-dot::after {
    content: "";
    position: absolute;
    inset: -0.15rem;
    border-radius: 50%;
    border: 2px solid var(--success);
    animation: done-ripple 0.6s ease-out;
  }
  @keyframes done-ripple {
    from {
      transform: scale(0.6);
      opacity: 0.8;
    }
    to {
      transform: scale(1.7);
      opacity: 0;
    }
  }
}
.row {
  display: flex;
  gap: 0.6rem;
  align-items: center;
}
.task > .row:first-child { min-width: 0; }
.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  color: var(--text-muted);
  font-size: 0.8rem;
}
.status {
  color: var(--text-muted);
  font-size: 0.8rem;
}
.task.uploading .status { color: var(--primary-dark); }
.task.failed .status { color: var(--danger); }
.sub {
  font-size: 0.8rem;
  color: var(--text-muted);
  min-height: 1.1rem;
}
.progress-row {
  display: grid;
  grid-template-columns: minmax(8rem, auto) minmax(5rem, 1fr) auto;
  gap: .7rem;
  align-items: center;
  min-width: 0;
  margin-top: .55rem;
}
.progress-info {
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: .78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bar {
  height: 6px;
  background: var(--surface-muted);
  border-radius: 3px;
  margin: 0.4rem 0;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--primary);
  transform: scaleX(var(--progress, 0));
  transform-origin: left;
  transition: transform 0.2s ease-out;
}
.actions {
  display: flex;
  gap: 0.4rem;
  justify-content: flex-end;
}
.actions button {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.3rem 0.65rem;
  font-size: 0.8rem;
  cursor: pointer;
}
.actions button:hover { border-color: var(--text); background: var(--surface-muted); }
.actions button.danger {
  color: var(--danger);
}
.error {
  color: var(--danger);
}
.hidden-input {
  /* sr-only: reachable via the "选择文件续传" button */
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 720px) {
  .progress-row { grid-template-columns: minmax(0, 1fr) auto; }
  .progress-info { grid-column: 1 / -1; }
  .progress-row .bar { grid-column: 1; }
  .progress-row .actions { grid-column: 2; }
}
</style>
