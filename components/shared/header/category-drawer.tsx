import { buttonVariants } from "@/components/ui/button-variants";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { getAllCategories } from "@/lib/actions/product.actions";
import { cn } from "@/lib/utils";
import { MenuIcon } from "lucide-react";
import Link from "next/link";

const CategoryDrawer = async () => {
  const categories = await getAllCategories();

  return (
    <Drawer direction="left">
      <DrawerTrigger
        className={cn(buttonVariants({ variant: "outline" }))}
      >
        <MenuIcon />
      </DrawerTrigger>
      <DrawerContent className="h-full max-w-sm">
        <DrawerHeader>
          <DrawerTitle>Select a category</DrawerTitle>
          <div className="space-y-1 mt-4">
            {categories.map((x) => (
              <DrawerClose asChild key={x.category}>
                <Link
                  href={`/search?category=${x.category}`}
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "w-full justify-start",
                  )}
                >
                  {x.category} ({x._count})
                </Link>
              </DrawerClose>
            ))}
          </div>
        </DrawerHeader>
      </DrawerContent>
    </Drawer>
  );
};

export default CategoryDrawer;
