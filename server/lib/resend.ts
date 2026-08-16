import type { Bindings } from '../env'

const RESEND_EMAILS_URL = 'https://api.resend.com/emails'

export class ResendEmailError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export async function sendMagicLinkEmail(
  env: Bindings,
  recipient: string,
  url: string,
  tokenHash: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) throw new ResendEmailError('RESEND_CONFIGURATION_ERROR')

  let response: Response
  try {
    response = await fetch(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `magic-link/${tokenHash}`,
        'User-Agent': 'drop/1.0',
      },
      body: JSON.stringify({
        from: env.MAGIC_LINK_FROM,
        to: [recipient],
        subject: 'Drop 登录链接',
        text: `打开以下链接登录 Drop：\n${url}\n\n链接将在 10 分钟后失效。如果不是你本人发起的请求，请忽略此邮件。`,
        html: `<p>打开以下链接登录 Drop：</p><p><a href="${url}">登录 Drop</a></p><p>链接将在 10 分钟后失效。如果不是你本人发起的请求，请忽略此邮件。</p>`,
      }),
    })
  } catch {
    throw new ResendEmailError('RESEND_NETWORK_ERROR')
  }

  if (!response.ok) throw new ResendEmailError(`RESEND_HTTP_${response.status}`)
}
