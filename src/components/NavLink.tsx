'use client'
import Link from 'next/link'
import { useLinkStatus } from 'next/link'

function Pending() {
  const { pending } = useLinkStatus()
  return pending ? <span aria-hidden style={{ opacity: .6 }}> …</span> : null
}

/** 導覽的唯一回饋原語：點下去到頁面換掉之間要有反應（PLAN §3）。 */
export function NavLink({
  href, children, ...rest
}: { href: string; children?: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <Link href={href} {...rest}>
      {children}
      <Pending />
    </Link>
  )
}
