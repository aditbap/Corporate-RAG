import type { NextConfig } from "next"; // restart again
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
};

export default nextConfig;
