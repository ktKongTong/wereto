import { DurableObject } from "cloudflare:workers";

const WEREAD_QPS = 25;
const REQUEST_INTERVAL_MS = Math.ceil(1000 / WEREAD_QPS);

export type WereadRateLimiterEnv = {
  WEREAD_RATE_LIMITER: DurableObjectNamespace<WereadRateLimiter>;
};

export class WereadRateLimiter extends DurableObject {
  private nextAllowedAt = 0;
  private tail: Promise<void> = Promise.resolve();

  async acquire() {
    const turn = this.tail.catch(() => undefined).then(() => this.waitForTurn());
    this.tail = turn;
    await turn;
  }

  private async waitForTurn() {
    const now = Date.now();
    const scheduledAt = Math.max(now, this.nextAllowedAt);
    this.nextAllowedAt = scheduledAt + REQUEST_INTERVAL_MS;

    const delay = scheduledAt - now;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export function createWereadRateLimiter(env: WereadRateLimiterEnv) {
  return env.WEREAD_RATE_LIMITER.getByName("global-weread-gateway");
}
