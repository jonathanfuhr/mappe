import { PrismaClient } from '@prisma/client'
import { env } from './env'

export const prisma = new PrismaClient({
  log: env.isDev ? ['warn', 'error'] : ['error'],
})

export async function disconnect(): Promise<void> {
  await prisma.$disconnect()
}
