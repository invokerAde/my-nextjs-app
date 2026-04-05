import ProductList from "@/components/shared/product/product-list";
import getLatestProducts from "@/lib/actions/product.actions";

const Homepage = async () => {
  const latestProducts = await getLatestProducts();

  const formattedProducts = latestProducts.map((product) => ({
    ...product,
    price:
      typeof product.price === "string"
        ? parseFloat(product.price)
        : product.price,
    rating:
      typeof product.rating === "string"
        ? parseFloat(product.rating)
        : product.rating,
  }));

  return (
    <>
      <ProductList data={formattedProducts} title="Newest Arrivals" />
    </>
  );
};

export default Homepage;
