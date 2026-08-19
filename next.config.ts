import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // 容器 E2E 用的精簡輸出：只帶必要的 node_modules，映像小很多
  output: 'standalone',
  experimental: {
    // 剛存好的東西要立刻看得到，不要被 client router cache 擋住
    staleTimes: { dynamic: 0 },
  },
}

export default nextConfig
