"use server";
import {prisma} from "@/db/seed"
import { convertToPlainobject } from "../utils";
import { LATEST_PRODUCTS_LIMIT } from "../constants";

async function getLatestProducts() {
  const data = await prisma.product.findMany({
    take: LATEST_PRODUCTS_LIMIT,
    orderBy: { createdAt: 'desc' },
  });

  // 👇 修复：把 Decimal 转成 number
  const fixedData = data.map((item) => ({
    ...item,
    price: item.price.toNumber(), // 核心修复
    rating: item.rating.toNumber(), // 评分也是 Decimal，一起转
  }));

  return convertToPlainobject(fixedData);
}

export default getLatestProducts;