import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@google-cloud/tasks"],
};

export default nextConfig;
