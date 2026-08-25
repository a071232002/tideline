import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import NotFound from '../src/app/[market]/[code]/not-found'

/**
 * 載入中與找不到這兩種畫面，在這之前**完全沒有設計**：換頁沒有任何回饋，
 * 找不到是 Next 的英文預設頁（"This page could not be found"）。
 *
 * **骨架屏做了又拿掉了。** 它把頁面包進 Suspense，而那讓 server action
 * 重新驗證時整個 client component 重新掛載——`useActionState` 的狀態沒了，
 * 改完本金的成功訊息**根本不會渲染**。用一個沒量過的好處（部署後的延遲）
 * 換一個看得到的迴歸，不划算。等部署之後量到真實延遲再決定。
 *
 * 錯誤頁是 client component（要 useEffect 與 reset callback），
 * 不在這裡渲染；它的行為由那個檔案本身的註解說明。
 */

describe('找不到這個代號', () => {
  const html = renderToStaticMarkup(<NotFound />)

  it('**兩種可能都要講**：打錯，或還沒加入追蹤', () => {
    // 這兩種要的下一步完全不同。只說「找不到」等於要使用者自己想起
    // 「這個站只抓清單裡的標的」這條規則。
    expect(html).toContain('打錯')
    expect(html).toContain('還沒加入追蹤')
  })

  it('要有回得去的路', () => {
    expect(html).toMatch(/href="\/"/)
    expect(html).toContain('回觀察清單')
  })

  it('不要出現「請聯絡客服」——沒有客服，寫了就是騙人', () => {
    expect(html).not.toMatch(/客服|support|聯絡我們/i)
  })
})
