import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ADK lazily imports optional integrations (GCS, MCP, DB drivers, express);
  // load it from node_modules at runtime instead of bundling it.
  serverExternalPackages: ["@google/adk"],
};

export default nextConfig;
