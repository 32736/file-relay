export const COPY = {
  actions: {
    cancel: '取消',
    close: '关闭',
    complete: '完成',
    copyLink: '复制链接',
    copied: '已复制',
    createShare: '创建分享',
    continueUpload: '继续',
    chooseFileContinueUpload: '选择文件继续上传',
    deleteSelected: '删除所选文件',
    download: '下载',
    downloadSelected: '下载所选文件',
    downloadSelectedCompact: '下载所选',
    multiSelect: '多选',
    pause: '暂停',
    retry: '重试',
    revoke: '撤销',
    revokeShare: '撤销分享',
    save: '保存',
    selectFileUpload: '选择文件上传',
    setFileRetention: '设置文件保存期限',
    share: '分享',
    undo: '撤销',
  },
  audit: {
    close: '关闭操作记录',
    empty: '暂无操作记录',
    actions: {
      'auth.login': '登录',
      'auth.login_magic_link': '魔法链接登录',
      'auth.logout': '退出登录',
      'file.uploaded': '上传文件',
      'file.downloaded': '下载文件',
      'file.deleted': '删除文件',
      'file.restored': '恢复文件',
      'file.expiration_updated': '更新文件保存期限',
      'share.created': '创建分享',
      'share.revoked': '撤销分享',
      'share.downloaded': '通过分享下载',
      'file.batch_downloaded': '下载所选文件（ZIP）',
    },
    loading: '加载中…',
    targets: {
      file: '文件',
      share: '分享',
      workspace: '工作区',
    },
    title: '操作记录',
  },
  common: {
    loading: '加载中',
    loadingEllipsis: '加载中…',
    permanent: '永久有效',
  },
  errors: {
    auditList: '操作记录加载失败，请重试',
    batchDownload: '批量下载失败，请重试',
    copy: '复制失败，请重试',
    delete: '删除失败，请重试',
    expiration: '文件保存期限更新失败，请重试',
    fileList: '文件列表加载失败，请重试',
    magicLinkInvalid: '登录链接无效或已过期',
    qrCode: '二维码生成失败，请使用复制链接',
    logout: '退出登录失败，请重试',
    magicLink: '发送登录链接失败，请稍后重试',
    shareList: '分享列表加载失败，请重试',
    shareCreate: '创建分享失败，请重试',
    sharePage: '该分享不存在或已失效',
    shareRevoke: '撤销分享失败，请重试',
    uploadArea: '上传区域尚未准备好，请重试',
  },
  files: {
    all: '全部文件',
    defaultRetention: '默认保存 30 天',
    empty: '暂无文件',
    list: '文件列表',
    noResults: '未找到匹配的文件',
    permanent: '永久保存',
    searchPlaceholder: '搜索文件名…',
    searchResults: '搜索结果',
  },
  feedback: {
    fileDeleted: '文件已删除',
    linkCopied: '链接已复制',
    shareCreated: '分享已创建',
    shareRevoked: '分享已撤销',
  },
  shares: {
    active: '有效',
    all: '全部分享',
    columnDownloads: '下载次数',
    columnValidity: '链接有效期',
    detail: '分享详情',
    empty: '暂无分享链接',
    expired: '已过期',
    exhausted: '下载次数已用完',
    list: '分享列表',
    management: '分享管理',
    noResults: '未找到匹配的分享链接',
    permanent: '永久有效',
    revoked: '已撤销',
    searchPlaceholder: '搜索分享文件…',
    searchResults: '搜索结果',
  },
  upload: {
    canceled: '已取消',
    completed: '上传完成',
    failed: '上传失败',
    fileRetention: '文件保存期限',
    helpWithDrag: '也可拖入页面任意位置 · 支持 Ctrl / ⌘ + V · 单文件最大 2 GB',
    helpWithoutDrag: '支持粘贴文件 · 单文件最大 2 GB',
    empty: '暂无上传任务',
    loadingZip: '生成 ZIP 中…',
    pause: '暂停',
    paused: '已暂停',
    queued: '等待上传',
    title: '上传文件',
    uploading: '上传中',
  },
} as const

export function formatFileCount(count: number): string {
  return `共${count}项`
}

export function formatFileRetention(
  expiresAt: number | null | undefined,
  formatDate: (epochSeconds: number) => string,
): string {
  if (expiresAt === null) return COPY.files.permanent
  if (expiresAt) return `到期时间 ${formatDate(expiresAt)}`
  return COPY.files.defaultRetention
}

export function getUploadStatusLabel(
  status: 'queued' | 'uploading' | 'paused' | 'completed' | 'failed' | 'canceled',
  canContinue: boolean,
): string {
  switch (status) {
    case 'queued':
      return COPY.upload.queued
    case 'uploading':
      return COPY.upload.uploading
    case 'paused':
      return canContinue ? COPY.upload.paused : '已暂停（需重新选择文件）'
    case 'completed':
      return COPY.upload.completed
    case 'failed':
      return COPY.upload.failed
    case 'canceled':
      return COPY.upload.canceled
  }
}

export function getShareStatusLabel(share: {
  revokedAt: number | null
  expiresAt: number | null
  maxDownloads: number | null
  downloadCount: number
}): string {
  if (share.revokedAt !== null) return COPY.shares.revoked
  if (share.expiresAt !== null && share.expiresAt <= Math.floor(Date.now() / 1000)) {
    return COPY.shares.expired
  }
  return share.maxDownloads !== null && share.downloadCount >= share.maxDownloads
    ? COPY.shares.exhausted
    : COPY.shares.active
}
