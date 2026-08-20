export interface ApiError {
  code: string
  message: string
}

const ERROR_MESSAGES: Record<string, string> = {
  CONFIGURATION_ERROR: '服务配置异常，请稍后重试',
  INVALID_STATE: '登录状态已失效，请重新登录',
  OAUTH_UPSTREAM_ERROR: '登录服务暂时不可用，请稍后重试',
  FORBIDDEN: '无权访问此内容',
  UNAUTHORIZED: '请先登录',
  VALIDATION_ERROR: '请求参数无效',
  PAYLOAD_TOO_LARGE: '文件超过允许的最大大小',
  NOT_FOUND: '请求的内容不存在',
  CONFLICT: '当前操作无法完成，请刷新后重试',
  SIZE_MISMATCH: '文件大小校验失败，请重试',
  INVALID_CHALLENGE: '验证已失效，请重试',
  INVALID_MAGIC_LINK: '登录链接无效或已过期',
  UPLOAD_INTERRUPTED: '上传已中断，请重试',
  UPSTREAM_ERROR: '存储服务暂时不可用，请稍后重试',
}

const MESSAGE_REPLACEMENTS: Array<[string, string]> = [
  ['File exceeds the maximum allowed size', '文件超过允许的最大大小'],
  ['File requires too many parts', '文件分片数量超过限制'],
  ['Invalid upload request', '上传请求无效'],
  ['Upload session not found', '上传任务不存在'],
  ['Upload session is not ready for content', '上传任务尚未准备好接收文件'],
  ['Upload session has expired', '上传任务已过期'],
  ['Part upload failed', '分片上传失败，请重试'],
  ['Upload was interrupted', '上传已中断，请重试'],
  ['Uploaded size does not match the declared size', '文件大小校验失败，请重试'],
  ['Assembled file size does not match the declared size', '文件大小校验失败，请重试'],
  ['File not found', '文件不存在'],
  ['File content is missing', '文件内容不存在'],
  ['File record is missing', '文件记录不存在'],
  ['Share not found', '分享不存在或已失效'],
  ['Share is no longer available', '分享已不可用'],
  ['Not authenticated', '请先登录'],
  ['OAuth state validation failed', '登录验证已失效，请重新登录'],
  ['GitHub token exchange failed', '登录服务暂时不可用，请稍后重试'],
  ['GitHub user lookup failed', '登录服务暂时不可用，请稍后重试'],
  ['GitHub OAuth is not configured', '服务配置异常，请稍后重试'],
  ['filename must not be empty', '文件名不能为空'],
  ['File name must not be empty', '文件名不能为空'],
  ['API route not found', '接口不存在，请检查操作后重试'],
  ['Cross-origin request rejected', '请求来源不受信任'],
  ['This GitHub account is not authorized', '此 GitHub 账号无权访问'],
  ['Failed to fetch', '网络连接失败，请稍后重试'],
  ['NetworkError when attempting to fetch resource', '网络连接失败，请稍后重试'],
  ['Load failed', '网络连接失败，请稍后重试'],
  ['network error', '网络连接失败，请稍后重试'],
  ['The network connection was lost', '网络连接失败，请稍后重试'],
]

export function localizeErrorMessage(code: string | undefined, message: string | undefined): string {
  const source = message?.trim()
  if (source) {
    const replacement = MESSAGE_REPLACEMENTS.find(([english]) => source.includes(english))
    if (replacement) return replacement[1]
    if (/^Request failed \(\d+\)$/.test(source)) {
      return `请求失败（${source.match(/\d+/)?.[0] ?? ''}）`
    }
  }
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]
  if (!source) return '请求失败，请稍后重试'
  // Do not surface browser/runtime English diagnostics in the UI. Messages
  // that already contain Chinese are kept so server-side detail remains useful.
  return /[\u3400-\u9FFF]/.test(source) ? source : '请求失败，请稍后重试'
}

/** Converts unknown UI catch values into a safe, localized user-facing error. */
export function getUserErrorMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback
  return localizeErrorMessage(undefined, cause.message || fallback)
}

/** Throws an Error with the API's structured message on non-2xx responses. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch (cause) {
    throw new Error(localizeErrorMessage(undefined, cause instanceof Error ? cause.message : String(cause)))
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: ApiError } | null
    throw new Error(
      localizeErrorMessage(body?.error?.code, body?.error?.message ?? `Request failed (${response.status})`),
    )
  }
  if (response.status === 204) return undefined as T
  try {
    return (await response.json()) as T
  } catch {
    throw new Error('服务器响应异常，请稍后重试')
  }
}
