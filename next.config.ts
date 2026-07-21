import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@google-cloud/tasks", "google-auth-library"],
};

export default nextConfig;
