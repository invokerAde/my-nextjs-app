import 'dotenv/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@/prisma/generated/prisma/client';
import * as crypto from 'crypto';

const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  // Use Zichao (admin)
  const sessionToken = crypto.randomUUID();
  const expires = new Date();
  expires.setDate(expires.getDate() + 7);

  await p.session.create({
    data: {
      sessionToken,
      userId: 'f9f7574a-7437-412c-ac49-95997aa25b06', // Zichao admin
      expires,
    },
  });
  console.log(`Session created: ${sessionToken}`);
  console.log(`Use: curl -X POST http://localhost:3000/api/admin/ai-analytics/text2sql -H 'Content-Type: application/json' -H 'Cookie: authjs.session-token=${sessionToken}' -d '{"question":"How many orders?"}' -w '\n\nHTTP %{http_code}\nTime: %{time_total}s'`);
  await p.$disconnect();
}
main();
