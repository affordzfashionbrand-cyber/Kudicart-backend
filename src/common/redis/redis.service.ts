import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { getRedisConnectionOptions } from '../../modules/queue/queue.constants';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Atomic Lua script for sliding-window rate limiting in Redis.
 * Uses a Redis Sorted Set (ZSET) where each hit is recorded with its timestamp.
 * Runs atomically in a single Redis tick to eliminate race conditions.
 */
export const SLIDING_WINDOW_LUA_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local clearBefore = now - window

-- Remove hits older than the current sliding window
redis.call('ZREMRANGEBYSCORE', key, '-inf', clearBefore)

-- Count hits remaining in current window
local currentHits = redis.call('ZCARD', key)

if currentHits < limit then
  -- Add unique timestamp entry (using now:counter format if identical ms)
  local member = tostring(now) .. ':' .. tostring(currentHits)
  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, ttl)
  return { 1, limit - currentHits - 1, 0 }
else
  -- Calculate retry-after based on oldest entry in window
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldestScore = tonumber(oldest[2])
  local retryAfter = 1
  if oldestScore then
    retryAfter = math.ceil((oldestScore + window - now) / 1000)
    if retryAfter < 1 then retryAfter = 1 end
  end
  return { 0, 0, retryAfter }
end
`;

/**
 * In-memory fallback Redis client for isolated test environments
 * and development without an external Redis server.
 * Accurately simulates atomic Lua scripts and multi-subscriber Pub/Sub.
 */
class InMemoryRedisBus {
  private static instance: InMemoryRedisBus;
  private readonly emitter = new EventEmitter();
  private readonly zsets = new Map<string, Map<string, number>>();
  private readonly ttls = new Map<string, number>();

  public static getInstance(): InMemoryRedisBus {
    if (!InMemoryRedisBus.instance) {
      InMemoryRedisBus.instance = new InMemoryRedisBus();
    }
    return InMemoryRedisBus.instance;
  }

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  publish(channel: string, message: string): number {
    this.emitter.emit(channel, message);
    return this.emitter.listenerCount(channel);
  }

  subscribe(channel: string, handler: (message: string) => void) {
    this.emitter.on(channel, handler);
  }

  unsubscribe(channel: string, handler: (message: string) => void) {
    this.emitter.off(channel, handler);
  }

  clearRateLimits() {
    this.zsets.clear();
    this.ttls.clear();
  }

  clearAll() {
    this.clearRateLimits();
    this.emitter.removeAllListeners();
  }

  executeSlidingWindow(
    key: string,
    now: number,
    window: number,
    limit: number,
    ttl: number,
  ): [number, number, number] {
    let set = this.zsets.get(key);
    if (!set) {
      set = new Map<string, number>();
      this.zsets.set(key, set);
    }

    const clearBefore = now - window;
    for (const [member, score] of Array.from(set.entries())) {
      if (score <= clearBefore) {
        set.delete(member);
      }
    }

    const currentHits = set.size;
    if (currentHits < limit) {
      const member = `${now}:${currentHits}`;
      set.set(member, now);
      this.ttls.set(key, now + ttl * 1000);
      return [1, limit - currentHits - 1, 0];
    } else {
      let oldestScore = now;
      for (const score of set.values()) {
        if (score < oldestScore) oldestScore = score;
      }
      const retryAfter = Math.max(1, Math.ceil((oldestScore + window - now) / 1000));
      return [0, 0, retryAfter];
    }
  }
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client?: Redis;
  private pubClient?: Redis;
  private subClient?: Redis;
  private isConnected = false;
  private isMemoryMode = false;
  private readonly memoryBus = InMemoryRedisBus.getInstance();
  private readonly subHandlers = new Map<string, (message: string) => void>();

  async onModuleInit() {
    await this.initClients();
  }

  async onModuleDestroy() {
    await this.disconnectAll();
  }

  public isReady(): boolean {
    return this.isConnected || this.isMemoryMode;
  }

  public isUsingRealRedis(): boolean {
    return this.isConnected && !this.isMemoryMode;
  }

  private async initClients() {
    const config = getRedisConnectionOptions();
    const isTest = process.env.NODE_ENV === 'test';
    const isProduction =
      process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';

    if (!config) {
      if (isProduction) {
        this.logger.error(
          'FATAL: Redis configuration (REDIS_HOST or REDIS_URL) is required in production mode',
        );
      } else {
        this.logger.log('Redis not configured. Operating in shared in-memory event bus mode.');
      }
      this.isMemoryMode = true;
      return;
    }

    try {
      const redisOptions: any = {
        host: config.host,
        port: config.port,
        password: config.password,
        username: config.username,
        tls: config.tls,
        lazyConnect: true,
        connectTimeout: 3000,
        maxRetriesPerRequest: null,
        retryStrategy: (times: number) => {
          if (times > 5 && isTest) return null; // do not retry indefinitely in tests
          return Math.min(times * 100, 3000);
        },
      };

      this.client = new Redis(redisOptions);
      this.pubClient = new Redis(redisOptions);
      this.subClient = new Redis(redisOptions);

      this.client.on('error', (err) => {
        this.logger.warn(`Redis Client connection error: ${err.message}`);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        this.logger.log(`Successfully connected to Redis at ${config.host}:${config.port}`);
      });

      // Connect with timeout guard
      await Promise.all([
        this.client.connect().catch((e) => {
          this.logger.warn(`Redis client connect failed: ${e.message}`);
        }),
        this.pubClient.connect().catch(() => {}),
        this.subClient.connect().catch(() => {}),
      ]);

      if (this.client.status === 'ready' || this.client.status === 'connect') {
        this.isConnected = true;
        this.isMemoryMode = false;
      } else {
        if (isProduction) {
          throw new Error('Could not establish ready connection to production Redis');
        }
        this.logger.warn('Redis unavailable. Falling back to shared in-memory bus for local dev/test.');
        this.isMemoryMode = true;
      }
    } catch (err: any) {
      if (isProduction) {
        throw new Error(`FATAL: Redis connection failed in production: ${err.message}`);
      }
      this.logger.warn(`Redis initialization failed (${err.message}). Using shared in-memory fallback.`);
      this.isMemoryMode = true;
    }
  }

  /**
   * Synchronous check on the shared in-memory bus (used in fast tests and non-Redis setups).
   */
  checkRateLimitSync(
    key: string,
    points: number,
    durationSeconds: number,
  ): RateLimitResult {
    const now = Date.now();
    const windowMs = durationSeconds * 1000;
    const ttlSeconds = durationSeconds * 2;

    const res = this.memoryBus.executeSlidingWindow(
      `kudicart:ratelimit:${key}`,
      now,
      windowMs,
      points,
      ttlSeconds,
    );

    return {
      allowed: res[0] === 1,
      remaining: res[1],
      retryAfterSeconds: res[2],
    };
  }

  /**
   * Evaluates the atomic sliding-window rate limit script in Redis.
   */
  async checkRateLimit(
    key: string,
    points: number,
    durationSeconds: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = durationSeconds * 1000;
    const ttlSeconds = durationSeconds * 2;

    if (this.isUsingRealRedis() && this.client) {
      try {
        const res = (await this.client.eval(
          SLIDING_WINDOW_LUA_SCRIPT,
          1,
          `kudicart:ratelimit:${key}`,
          now.toString(),
          windowMs.toString(),
          points.toString(),
          ttlSeconds.toString(),
        )) as [number, number, number];

        return {
          allowed: res[0] === 1,
          remaining: res[1],
          retryAfterSeconds: res[2],
        };
      } catch (err: any) {
        this.logger.error(`Redis checkRateLimit error on key ${key}: ${err.message}`);
        throw err;
      }
    }

    return this.checkRateLimitSync(key, points, durationSeconds);
  }

  /**
   * Publishes an event payload to a Redis Pub/Sub channel.
   */
  async publish(channel: string, message: Record<string, any> | string): Promise<number> {
    const serialized = typeof message === 'string' ? message : JSON.stringify(message);

    if (this.isUsingRealRedis() && this.pubClient) {
      try {
        return await this.pubClient.publish(channel, serialized);
      } catch (err: any) {
        this.logger.error(`Failed to publish to Redis channel ${channel}: ${err.message}`);
        throw err;
      }
    }

    return this.memoryBus.publish(channel, serialized);
  }

  /**
   * Subscribes to a Redis Pub/Sub channel.
   */
  async subscribe(
    channel: string,
    handler: (channel: string, message: string) => void,
  ): Promise<void> {
    if (this.isUsingRealRedis() && this.subClient) {
      await this.subClient.subscribe(channel);
      this.subClient.on('message', (chan, msg) => {
        if (chan === channel) {
          handler(chan, msg);
        }
      });
      return;
    }

    const memHandler = (msg: string) => handler(channel, msg);
    this.subHandlers.set(channel, memHandler);
    this.memoryBus.subscribe(channel, memHandler);
  }

  /**
   * Unsubscribes from a Redis Pub/Sub channel.
   */
  async unsubscribe(channel: string): Promise<void> {
    if (this.isUsingRealRedis() && this.subClient) {
      await this.subClient.unsubscribe(channel);
      return;
    }

    const handler = this.subHandlers.get(channel);
    if (handler) {
      this.memoryBus.unsubscribe(channel, handler);
      this.subHandlers.delete(channel);
    }
  }

  /**
   * Resets in-memory rate limiting keys (for testing).
   */
  resetInMemoryState() {
    this.memoryBus.clearRateLimits();
  }

  async disconnectAll() {
    try {
      if (this.subClient) await this.subClient.quit().catch(() => {});
      if (this.pubClient) await this.pubClient.quit().catch(() => {});
      if (this.client) await this.client.quit().catch(() => {});
    } catch {
      // ignore teardown errors
    } finally {
      this.isConnected = false;
      this.memoryBus.clearAll();
    }
  }
}
