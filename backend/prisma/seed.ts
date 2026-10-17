import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.DEMO_USER_EMAIL ?? "demo@example.com";
  const user = await prisma.user.upsert({
    where: { googleId: "local-demo-user" },
    create: { googleId: "local-demo-user", email, name: "Demo User" },
    update: { email, name: "Demo User" },
  });
  console.info(`Seeded demo user ${user.email} (${user.id}). Use a local session or configure Google OAuth to sign in.`);
}

main().catch((error: unknown) => {
  console.error("Database seed failed.", error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
