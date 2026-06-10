import Redis from 'ioredis'

const url = process.env.REDIS_URL ?? 'redis://localhost:6379'

// Main client — maxRetriesPerRequest:null required by BullMQ
export const redis = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false })

// Separate client for BullMQ event subscriptions (blocking commands)
export const redisSub = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false })
