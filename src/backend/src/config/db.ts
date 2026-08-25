import { PrismaClient } from '@prisma/client';
import { config } from './index';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma =
  global.prisma ||
  new PrismaClient({
    log: config.env === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (config.env !== 'production') {
  global.prisma = prisma;
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    return false;
  }
}
