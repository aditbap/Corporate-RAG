import type { NextConfig } from "next";
import path from "path";

const repoRoot = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (infra/docker/Dockerfile.web).
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
