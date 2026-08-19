/**
 * 線性 SVG 圖示。**不用 emoji**——emoji 當圖示是套版感最明顯的來源，
 * 而且各平台長得都不一樣、大小對不齊、顏色不受控（PLAN §3）。
 *
 * 這裡的圖示一律：
 *   - 線性、1.6 粗、圓端點，跟介面的細邊框同一個語彙
 *   - `stroke="currentColor"`，顏色由外面決定，深色模式自動跟著走
 *   - 沒有文字時外層一定要有 aria-label，圖示本身 aria-hidden
 */

export type IconName =
  | 'plus' | 'minusCircle' | 'back' | 'chevronUp'
  | 'sun' | 'moon' | 'auto' | 'logout'

const PATHS: Record<IconName, React.ReactNode> = {
  plus: <><path d="M10 4v12M4 10h12" /></>,
  // 「從清單移除」不是「刪除這檔股票」——垃圾桶會讓人以為資料被砍了。
  // 圓圈減號的語意就是「從這個集合拿掉」，剛好。
  minusCircle: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M6.6 10h6.8" />
    </>
  ),
  back: <><path d="M12 4 6 10l6 6" /></>,
  // 收合用向上的角括號。× 是「關閉／捨棄」，跟「收起來待會再展開」不是同一件事。
  chevronUp: <><path d="M5 12.5 10 7.5l5 5" /></>,
  // 登出：人走出門。用 × 或電源鍵都會被讀成「關掉什麼東西」。
  logout: (
    <>
      <path d="M12.5 6.2V4.6a1.4 1.4 0 0 0-1.4-1.4H4.9a1.4 1.4 0 0 0-1.4 1.4v10.8a1.4 1.4 0 0 0 1.4 1.4h6.2a1.4 1.4 0 0 0 1.4-1.4v-1.6" />
      <path d="M8.6 10h8M14 7.4 16.6 10 14 12.6" />
    </>
  ),
  sun: (
    <>
      <circle cx="10" cy="10" r="3.4" />
      <path d="M10 2.2v1.6M10 16.2v1.6M2.2 10h1.6M16.2 10h1.6M4.5 4.5l1.1 1.1M14.4 14.4l1.1 1.1M15.5 4.5l-1.1 1.1M5.6 14.4l-1.1 1.1" />
    </>
  ),
  moon: <><path d="M16 11.2A6.4 6.4 0 0 1 8.8 4a6.5 6.5 0 1 0 7.2 7.2Z" /></>,
  auto: (
    <>
      <rect x="2.8" y="4" width="14.4" height="9.6" rx="1.4" />
      <path d="M7 16.6h6" />
    </>
  ),
}

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
