import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

/** A wallpaper preview: a cached thumbnail (the screenshots generator, any
 * image the `image` crate decodes), or the file name when it can't (HEIC). */
export function Thumb({
  path,
  empty,
  className = '',
}: {
  path: string | null
  /** Shown when there is no image. */
  empty: string
  className?: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    setSrc(null)
    if (!path) return
    let live = true
    invoke<string>('screenshot_thumb', { path })
      .then((t) => live && setSrc(convertFileSrc(t)))
      .catch(() => live && setSrc(null))
    return () => {
      live = false
    }
  }, [path])
  const name = path ? path.split('/').pop() : null
  return (
    <div className={`thumb${path ? '' : ' none'} ${className}`}>
      {src ? <img src={src} alt="" /> : null}
      <span className="thumb-label">{name ?? empty}</span>
    </div>
  )
}
