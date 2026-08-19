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
  border: 2px dashed var(--drop-ink);
  border-radius: 0;
  padding: 2.75rem 1.5rem 2.25rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  background: var(--drop-surface);
  color: var(--drop-ink-2);
  cursor: pointer;
}
.upload-zone .drop-area::before {
  content: "+";
  position: absolute;
  top: -0.75rem;
  left: -0.75rem;
  width: 1.4rem;
  height: 1.4rem;
  display: grid;
  place-items: center;
  background: var(--drop-brand);
  color: var(--drop-background);
  font-family: var(--font-micro);
  font-weight: 700;
  line-height: 1;
}
.upload-zone .drop-area:hover,
.upload-zone.dragging .drop-area {
  border-style: solid;
  border-color: var(--drop-brand);
  background: var(--drop-surface-muted);
}
.drop-title {
  margin: 0;
  font-family: var(--font-macro);
  font-size: 1.2rem;
  font-weight: 900;
  letter-spacing: -0.01em;
  color: var(--drop-ink);
}
.upload-zone .drop-area.compact {
  padding: 1.1rem 1rem;
  flex-direction: column;
  justify-content: center;
  gap: 0.25rem;
}
.upload-zone .drop-area.compact .drop-title {
  font-size: 0.95rem;
}
.drop-sub {
  margin: 0;
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
}
.standalone-input {
  display: none;
}
.tasks {
  list-style: none;
  margin: 0.875rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.task {
  border: 1px solid var(--drop-line);
  border-radius: 0;
  padding: 0.875rem 1rem;
  background: var(--drop-surface);
  color: var(--drop-ink-2);
}
.task.completed {
  border-left: 4px solid var(--drop-state-success);
}
.task.failed {
  border-left: 4px solid var(--drop-state-error);
}
.done-dot {
  width: 0.65rem;
  height: 0.65rem;
  background: var(--drop-state-success);
  position: relative;
  flex: none;
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
  font-weight: 600;
  color: var(--drop-ink);
}
.meta {
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
}
.status {
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
}
.task.uploading .status { color: var(--drop-brand); font-weight: 700; }
.task.failed .status { color: var(--drop-state-error); font-weight: 700; }
.progress-row {
  display: grid;
  grid-template-columns: minmax(8rem, auto) minmax(5rem, 1fr) auto;
  gap: .7rem;
  align-items: center;
  min-width: 0;
  margin-top: .6rem;
}
.progress-info {
  min-width: 0;
  overflow: hidden;
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: .72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.bar {
  height: 8px;
  background: var(--drop-surface-muted);
  border: 1px solid var(--drop-line);
  margin: 0.4rem 0;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--drop-brand);
  transform: scaleX(var(--progress, 0));
  transform-origin: left;
  transition: transform 0.25s linear;
}
.actions {
  display: flex;
  gap: 0.4rem;
  justify-content: flex-end;
}
.actions button {
  background: var(--drop-surface);
  border: 1px solid var(--drop-line);
  color: var(--drop-ink-2);
  border-radius: 0;
  padding: 0.3rem 0.65rem;
  font-family: var(--font-micro);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
}
.actions button:hover { background: var(--drop-ink); border-color: var(--drop-ink); color: var(--drop-background); }
.actions button.danger {
  color: var(--drop-state-error);
}
.actions button.danger:hover { background: var(--drop-state-error); border-color: var(--drop-ink); color: var(--drop-background); }
.error {
  color: var(--drop-state-error);
}
.hidden-input {
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
