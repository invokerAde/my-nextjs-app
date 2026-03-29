import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

//prisma into js object
export function convertToPlainobject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

//format number with decimal place
export function formatNumberWithDecimal(num: number): string {
  const [int, decimal] = num.toString().split(".");
  return decimal ? `${int}.${decimal.padEnd(2,'0')}`:`${int}.00`;
}
