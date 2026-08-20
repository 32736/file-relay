/** Returns file payloads from a paste event without consuming pasted text. */
export function filesFromClipboard(event: ClipboardEvent): File[] {
  const files = Array.from(event.clipboardData?.files ?? [])
  if (files.length > 0) return files

  return Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
}

/** Copies text with a legacy fallback for non-secure or older browser contexts. */
export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    if (!document.execCommand('copy')) throw new Error('复制失败，请重试')
  } finally {
    textarea.remove()
  }
}
