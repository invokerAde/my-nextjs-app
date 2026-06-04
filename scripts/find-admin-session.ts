import 'dotenv/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@/prisma/generated/prisma/client';

const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const users = await p.user.findMany({ select: { id: true, name: true, email: true, role: true } });
  console.log('Users:');
  for (const u of users) console.log(`  ${u.name} <${u.email}> role=${u.role} id=${u.id}`);

  const admin = users.find((u: any) => u.role === 'admin');
  if (admin) {
    const sessions = await p.session.findMany({
      where: { userId: admin.id },
      select: { sessionToken: true, expires: true },
      orderBy: { expires: 'desc' },
    });
    console.log(`\nAdmin sessions (${sessions.length}):`);
    for (const s of sessions) console.log(`  token=${s.sessionToken.substring(0, 20)}... expires=${s.expires}`);
  } else {
    console.log('\nNo admin user found!');
  }
  await p.$disconnect();
}
main();
