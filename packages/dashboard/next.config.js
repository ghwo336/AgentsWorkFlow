/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow importing the shared workspace package (TS source) directly.
  transpilePackages: ["@agent-loop/shared"],
};

export default nextConfig;
