import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * standalone 只給容器建置用。
   *
   * 這個設定會讓 `next start` 失效——Next 只印一行警告然後照樣啟動，
   * 頁面卻是壞的，看起來就像「網頁沒起來」。所以用環境變數關起來，
   * 只有 Dockerfile 會打開它。
   */
  output: process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
  experimental: {
    // 剛存好的東西要立刻看得到，不要被 client router cache 擋住
    staleTimes: { dynamic: 0 },
  },
}

export default nextConfig
