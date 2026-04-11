import { Redis } from "ioredis";

export function createRedisConnection(url: string) {
  return new Redis(url, {
    maxRetriesPerRequest: null
  });
}
