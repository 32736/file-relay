<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { useUploads, type UploadTask } from '../composables/useUploads'
import { formatBytes } from '../lib/format'

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

function percent(task: UploadTask): number {
  return task.size > 0 ? Math.min(100, Math.round((task.transferred / task.size) * 100)) : 0
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

function onDrop(event: DragEvent): void {
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

defineExpose({ addFiles })
</script>

<template>
  <section
    class="upload-zone"
    :class="{ dragging }"
  >
    <div
      class="drop-area"
      role="button"
      tabindex="0"
      @dragenter.prevent="dragging = true"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
      @keydown.enter.prevent="pickInput?.click()"
      @click="pickInput?.click()"
    >
      <p>
        拖放文件到这里，或
        <label class="pick">
          选择文件
          <input
            type="file"
            multiple
            @change="onPickFiles"
          >
        </label>
      </p>
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
          <span class="name">{{ task.name }}</span>
          <span class="meta">{{ formatBytes(task.size) }}</span>
          <span class="status">{{ statusLabel(task) }}</span>
        </div>
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
        <div class="row sub">
          <span v-if="task.status === 'uploading'">
            {{ percent(task) }}% · {{ formatBytes(speeds[task.uploadId] ?? 0) }}/s
          </span>
          <span
            v-else-if="task.status === 'failed'"
            class="error"
            role="alert"
          >
            {{ task.error }}
          </span>
          <span v-else-if="task.status === 'paused' && !hasFile(task.uploadId)">
            刷新后文件已丢失，重新选择同一文件可继续
          </span>
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
  border: 2px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  padding: 2rem;
  text-align: center;
}
.upload-zone.dragging .drop-area {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.pick input {
  display: none;
}
.pick {
  cursor: pointer;
  color: var(--accent);
  text-decoration: underline;
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
  padding: 0.6rem 0.8rem;
}
.task.completed {
  opacity: 0.7;
}
.row {
  display: flex;
  gap: 0.6rem;
  align-items: center;
}
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
.sub {
  font-size: 0.8rem;
  color: var(--text-muted);
  min-height: 1.1rem;
}
.bar {
  height: 6px;
  background: #eee;
  border-radius: 3px;
  margin: 0.4rem 0;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--accent);
  transform: scaleX(var(--progress, 0));
  transform-origin: left;
  transition: transform 0.2s ease-out;
}
.actions {
  display: flex;
  gap: 0.4rem;
}
.actions button {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.2rem 0.6rem;
  font-size: 0.8rem;
  cursor: pointer;
}
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
</style>
