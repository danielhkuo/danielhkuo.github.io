import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  // Enable static export for GitHub Pages
  output: "export",

  // Configure for GitHub Pages subdirectory if needed
  // basePath: "",

  // Disable image optimization for static export
  images: {
    unoptimized: true,
  },

  // Performance optimizations
  compress: true,
  poweredByHeader: false,

  // Optimize production builds
  experimental: {
    optimizePackageImports: ['react-icons'],
  },
};

export default nextConfig;
