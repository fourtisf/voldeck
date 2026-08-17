import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';
export { PrismaClient };

let client: PrismaClient | undefined;

/** Shared singleton PrismaClient (one pool per process). */
export function getPrisma(): PrismaClient {
  if (!client) client = new PrismaClient();
  return client;
}
