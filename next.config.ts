import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    // 剛存好的東西要立刻看得到，不要被 client router cache 擋住
    staleTimes: { dynamic: 0 },
  },
}

export default nextConfig
