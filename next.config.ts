import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run（Docker）向けに自己完結サーバーを出力する
  output: "standalone",
};

export default nextConfig;
