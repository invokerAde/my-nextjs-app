"use server";
import {prisma} from "@/db/prisma"
import { convertToPlainobject } from "../utils";
import { LATEST_PRODUCTS_LIMIT } from "../constants";

async function getLatestProducts() {

  const data = await prisma.product.findMany({
    take: LATEST_PRODUCTS_LIMIT,
    orderBy: { createdAt: "desc" },
  });
  return convertToPlainobject(data);
}

// Get single product by it's slug
export async function getProductBySlug(slug: string) {
  return await prisma.product.findFirst({
    where: { slug: slug },
  });
}

export default getLatestProducts;
