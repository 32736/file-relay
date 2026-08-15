import { reactive } from 'vue'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

const toasts = reactive<ToastItem[]>([])
let nextId = 1

/** Pushes a transient toast (auto-dismissed after `duration` ms). */
export function toast(message: string, kind: ToastKind = 'info', duration = 3000): void {
  const id = nextId++
  toasts.push({ id, kind, message })
  setTimeout(() => {
    const index = toasts.findIndex((item) => item.id === id)
    if (index >= 0) toasts.splice(index, 1)
  }, duration)
}

export function useToasts(): ToastItem[] {
  return toasts
}
