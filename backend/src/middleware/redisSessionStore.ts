import session from "express-session";
import type { SessionData } from "express-session";
import { redis } from "../queues/connection.js";

export class RedisSessionStore extends session.Store {
  private readonly prefix = "email-scheduler:session:";

  get(sid: string, callback: (error: unknown, session?: SessionData | null) => void): void {
    void redis.get(`${this.prefix}${sid}`).then((value: string | null) => {
      callback(null, value ? JSON.parse(value) as SessionData : null);
    }).catch(callback);
  }

  set(sid: string, value: SessionData, callback?: (error?: unknown) => void): void {
    const ttl = Math.max(1, Math.ceil((value.cookie.maxAge ?? 86400000) / 1000));
    void redis.set(`${this.prefix}${sid}`, JSON.stringify(value), "EX", ttl)
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  destroy(sid: string, callback?: (error?: unknown) => void): void {
    void redis.del(`${this.prefix}${sid}`).then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  touch(sid: string, value: SessionData, callback?: (error?: unknown) => void): void {
    const ttl = Math.max(1, Math.ceil((value.cookie.maxAge ?? 86400000) / 1000));
    void redis.expire(`${this.prefix}${sid}`, ttl).then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }
}
