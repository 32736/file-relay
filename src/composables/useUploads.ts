import { computed, ref } from 'vue'

import {
  type PendingUploadRecord,
  type UploadMode,
  type UploadSessionInfo,
  abortUpload,
  completeUpload,
  createUploadSession,
  fetchSessionState,
  loadPendingUploads,
  savePendingUploads,
  uploadFileCore,
} from '../lib/uploader'

export type TaskStatus = 'queued' | 'uploading' | 'paused' | 'completed' | 'failed' | 'canceled'

export interface UploadTask extends PendingUploadRecord {
  status: TaskStatus
  transferred: number
  error?: string
}

const MAX_CONCURRENT = 3

function fileMatchesRecord(file: File, record: PendingUploadRecord): boolean {
  return (
    file.name === record.name &&
    file.size === record.size &&
    file.lastModified === record.lastModified
  )
}

export function useUploads(onListRefresh: () => void) {
  const tasks = ref<UploadTask[]>([])
  const controllers = new Map<string, AbortController>()
  const fileCache = new Map<string, File>()
  let active = 0
  const waiters: (() => void)[] = []

  const queuedOrRunning = computed(() =>
    tasks.value.some((task) => task.status === 'queued' || task.status === 'uploading'),
  )

  function persist(): void {
    const pending = tasks.value
      .filter((task) => task.status === 'queued' || task.status === 'uploading' || task.status === 'paused')
      .map((task) => ({
        uploadId: task.uploadId,
        name: task.name,
        size: task.size,
        type: task.type,
        lastModified: task.lastModified,
        mode: task.mode,
        chunkSize: task.chunkSize,
        totalParts: task.totalParts,
        createdAt: task.createdAt,
      }))
    savePendingUploads(pending)
  }

  function updateTask(uploadId: string, patch: Partial<UploadTask>): void {
    const task = tasks.value.find((item) => item.uploadId === uploadId)
    if (task) Object.assign(task, patch)
  }

  async function acquire(): Promise<void> {
    if (active < MAX_CONCURRENT) {
      active++
      return
    }
    await new Promise<void>((resolve) => waiters.push(resolve))
    active++
  }

  function release(): void {
    active--
    waiters.shift()?.()
  }

  /** Runs a task to completion (or pause/cancel), starting from server state. */
  async function runTask(task: UploadTask, file: File): Promise<void> {
    fileCache.set(task.uploadId, file)
    await acquire()
    try {
      if (task.status === 'canceled') return

      // Resolve current server progress (resume after pause or refresh).
      let skipParts = new Set<number>()
      let session: UploadSessionInfo = {
        uploadId: task.uploadId,
        mode: task.mode,
        chunkSize: task.chunkSize,
        totalParts: task.totalParts,
      }
      try {
        const state = await fetchSessionState(task.uploadId)
        if (state.status === 'completed') {
          updateTask(task.uploadId, { status: 'completed', transferred: task.size })
          persist()
          onListRefresh()
          return
        }
        if (state.status === 'aborted' || state.status === 'failed') {
          updateTask(task.uploadId, { status: 'canceled' })
          persist()
          return
        }
        session = {
          uploadId: task.uploadId,
          mode: state.mode,
          chunkSize: state.chunkSize,
          totalParts: state.totalParts,
        }
        skipParts = new Set((state.completedParts ?? []).map((part) => part.partNumber))
        const resumedBytes = Array.from(skipParts).reduce(
          (sum, number) => sum + Math.min(state.chunkSize, Math.max(0, task.size - (number - 1) * state.chunkSize)),
          0,
        )
        updateTask(task.uploadId, { transferred: resumedBytes })
      } catch {
        // Session lookup failed (expired/gone) → treat as failed.
        updateTask(task.uploadId, { status: 'failed', error: '上传会话已失效' })
        persist()
        return
      }

      const controller = new AbortController()
      controllers.set(task.uploadId, controller)
      updateTask(task.uploadId, { status: 'uploading' })

      try {
        await uploadFileCore({
          file,
          session,
          skipParts,
          signal: controller.signal,
          onProgress: (transferred) => updateTask(task.uploadId, { transferred }),
        })
        await completeUpload(task.uploadId)
        updateTask(task.uploadId, { status: 'completed', transferred: task.size })
        fileCache.delete(task.uploadId)
        onListRefresh()
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortUploadError') {
          // cancel() flips the status concurrently, so read the live value.
          const live = tasks.value.find((item) => item.uploadId === task.uploadId)
          if (controller.signal.aborted && live?.status !== 'canceled') {
            updateTask(task.uploadId, { status: 'paused' })
          }
        } else {
          updateTask(task.uploadId, {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      } finally {
        controllers.delete(task.uploadId)
        persist()
      }
    } finally {
      release()
    }
  }

  function addFile(file: File): void {
    // Resume match: same name+size+lastModified as a pending record.
    const pending = tasks.value.find(
      (task) =>
        (task.status === 'paused' || task.status === 'failed') &&
        fileMatchesRecord(file, task),
    )
    if (pending) {
      updateTask(pending.uploadId, { error: undefined })
      void runTask(pending, file)
      return
    }

    void (async () => {
      let session: UploadSessionInfo
      try {
        session = await createUploadSession(file)
      } catch (error) {
        tasks.value.push({
          uploadId: `err-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
          mode: 'single',
          chunkSize: 0,
          totalParts: 1,
          createdAt: Date.now(),
          status: 'failed',
          transferred: 0,
          error: error instanceof Error ? error.message : String(error),
        })
        return
      }
      const task: UploadTask = {
        uploadId: session.uploadId,
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        mode: session.mode,
        chunkSize: session.chunkSize,
        totalParts: session.totalParts,
        createdAt: Date.now(),
        status: 'queued',
        transferred: 0,
      }
      tasks.value.push(task)
      persist()
      void runTask(task, file)
    })()
  }

  function addFiles(files: File[]): void {
    for (const file of files) addFile(file)
  }

  function pause(uploadId: string): void {
    const controller = controllers.get(uploadId)
    if (controller && !controller.signal.aborted) controller.abort()
    else updateTask(uploadId, { status: 'paused' })
    persist()
  }

  function resume(uploadId: string): void {
    const task = tasks.value.find((item) => item.uploadId === uploadId)
    if (!task || task.status !== 'paused') return
    const file = fileCache.get(uploadId)
    updateTask(uploadId, { status: 'queued', error: undefined })
    if (file) {
      void runTask(task, file)
    }
    // Without a cached file (after a refresh) the UI asks the user to re-pick.
    persist()
  }

  function cancel(uploadId: string): void {
    const controller = controllers.get(uploadId)
    if (controller && !controller.signal.aborted) controller.abort()
    updateTask(uploadId, { status: 'canceled' })
    fileCache.delete(uploadId)
    void abortUpload(uploadId).catch(() => undefined)
    persist()
  }

  function retry(uploadId: string): void {
    const task = tasks.value.find((item) => item.uploadId === uploadId)
    if (!task || (task.status !== 'failed' && task.status !== 'canceled')) return
    const file = fileCache.get(uploadId)
    updateTask(uploadId, { status: 'queued', error: undefined })
    if (file) {
      void runTask(task, file)
    }
    persist()
  }

  /** Restores persisted records after a refresh; user re-picks the file to resume. */
  async function restore(): Promise<void> {
    const records = loadPendingUploads()
    const current = new Set(tasks.value.map((task) => task.uploadId))
    for (const record of records) {
      if (current.has(record.uploadId)) continue
      tasks.value.push({ ...record, status: 'paused', transferred: 0 })
    }
    // Prune records whose sessions are gone.
    const alive: PendingUploadRecord[] = []
    for (const task of tasks.value) {
      if (task.status !== 'paused') continue
      try {
        const state = await fetchSessionState(task.uploadId)
        if (state.status === 'completed' || state.status === 'aborted') {
          updateTask(task.uploadId, { status: state.status === 'completed' ? 'completed' : 'canceled' })
          continue
        }
        alive.push(task)
      } catch {
        updateTask(task.uploadId, { status: 'canceled' })
      }
    }
    savePendingUploads(alive)
  }

  function hasFile(uploadId: string): boolean {
    return fileCache.has(uploadId)
  }

  return { tasks, queuedOrRunning, addFiles, pause, resume, cancel, retry, restore, hasFile }
}

export type { UploadMode }
