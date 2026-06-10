import { Expo, ExpoPushMessage } from 'expo-server-sdk'
import type { PrismaClient } from '@prisma/client'

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN || undefined })

export async function sendPushToOrg(
  db: PrismaClient,
  orgId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const users = await db.user.findMany({
    where: { org_id: orgId },
    select: { expo_push_tokens: true },
  })

  const tokens = users
    .flatMap(u => u.expo_push_tokens as string[])
    .filter(t => Expo.isExpoPushToken(t))

  if (tokens.length === 0) return

  const messages: ExpoPushMessage[] = tokens.map(token => ({
    to: token,
    title,
    body,
    data,
    sound: 'default',
    priority: 'high',
  }))

  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      await expo.sendPushNotificationsAsync(chunk)
    } catch (err) {
      console.error('[push] delivery error:', err)
    }
  }
}
