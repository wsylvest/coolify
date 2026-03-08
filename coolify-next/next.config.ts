import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Enable experimental features
  experimental: {
    // Enable server actions
    serverActions: {
      bodySizeLimit: "10mb",
    },
    // Optimize package imports
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-icons",
      "date-fns",
    ],
  },

  // Webpack configuration for SSH2 and other Node.js modules
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Don't bundle server-only modules on client
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        dns: false,
        child_process: false,
      };
    }

    // Handle native modules
    config.externals = config.externals || [];
    if (isServer) {
      config.externals.push({
        "ssh2": "commonjs ssh2",
        "cpu-features": "commonjs cpu-features",
      });
    }

    return config;
  },

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "github.com",
      },
    ],
  },

  // Headers for security
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Referrer-Policy",
            value: "origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
