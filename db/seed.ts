import "dotenv/config"; // 1. 必须加载环境变量
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/prisma/generated/prisma/client";
import sampleData from "./sample-data";

// --- 配置适配器 (与 lib/db.ts 保持一致) ---
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
// --- 实例化客户端 ---
// 注意：这里不再需要 "as any"，而是必须传入 adapter
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log(" 开始同步数据...");

  try {
    // 1. 清空旧数据
    await prisma.product.deleteMany();
    await prisma.account.deleteMany();
    await prisma.session.deleteMany();
    await prisma.verificationToken.deleteMany();
    await prisma.user.deleteMany();
    console.log("旧数据已清空");

    // 2. 写入新数据
    await prisma.product.createMany({
      data: sampleData.products,
    });
    await prisma.user.createMany({
      data: sampleData.users,
    });

    console.log(" Database seeded Successfully!");
  } catch (error) {
    console.error("  seeding 失败:", error);
  } finally {
    // 5. 重要：脚本执行完后必须断开连接
    await prisma.$disconnect();
  }
}

main();
