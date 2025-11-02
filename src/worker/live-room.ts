import { DurableObject } from 'cloudflare:workers'

export class LiveRoom extends DurableObject {
  // In-memory state
  sessionId = ''

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)

    // `blockConcurrencyWhile()` ensures no requests are delivered until initialization completes.
    ctx.blockConcurrencyWhile(async () => {
      // After initialization, future reads do not need to access storage.
      this.sessionId = (await ctx.storage.get('sid')) || ''
    })
  }

  async getSessionId(): Promise<string> {
    return await this.ctx.storage.get('sid') || this.sessionId
  }

  async setSessionId(sid: string): Promise<void> {
    this.sessionId = sid
    await this.ctx.storage.put('sid', sid)
  }
}
