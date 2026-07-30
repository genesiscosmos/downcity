import { homepage_positioning } from "@/lib/homepage-positioning";

export type DowncityProduct = {
  name: string;
  productName: string;
  version: string;
  description: string;
  homepage?: string;
};

export const product: DowncityProduct = {
  name: "downcity",
  productName: "Downcity",
  version: "1.0.0",
  description: homepage_positioning.en.meta_description,
  homepage: "https://downcity.ai",
};
