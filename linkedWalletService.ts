import { prisma } from '../database/prisma';
import { env } from '../config/env';

let bootstrapDone = false;

export async function ensureBootstrapAdmins(): Promise<void> {
  if (bootstrapDone) return;
  bootstrapDone = true;
  for (const id of env.TELEGRAM_BOOTSTRAP_ADMINS) {
    try {
      const tid = BigInt(id);
      await prisma.admin.upsert({
        where: { telegramId: tid },
        update: {},
        create: { telegramId: tid },
      });
    } catch {
      // skip non-numeric
    }
  }
}

export async function isAdmin(telegramId: number | bigint): Promise<boolean> {
  const tid = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
  const found = await prisma.admin.findUnique({ where: { telegramId: tid } });
  return !!found;
}

export async function addAdmin(telegramId: number | bigint, username?: string, addedBy?: bigint): Promise<void> {
  const tid = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
  await prisma.admin.upsert({
    where: { telegramId: tid },
    update: { username },
    create: { telegramId: tid, username, addedById: addedBy },
  });
}

export async function removeAdmin(telegramId: number | bigint): Promise<void> {
  const tid = typeof telegramId === 'bigint' ? telegramId : BigInt(telegramId);
  await prisma.admin.delete({ where: { telegramId: tid } }).catch(() => undefined);
}

export async function listAdmins() {
  return prisma.admin.findMany({ orderBy: { addedAt: 'asc' } });
}
