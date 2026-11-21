/**
 * CLI: `pnpm db:seed` (requires DATABASE_URL and SEED_DEFAULT_PASSWORD).
 * The demo password is for development only; see .env.example.
 */
import { createPrismaClient } from './index';
import { seedDatabase } from './seed-data';

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    await seedDatabase(prisma, {
      defaultPassword: process.env.SEED_DEFAULT_PASSWORD ?? '',
      log: (message) => console.log(message),
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
