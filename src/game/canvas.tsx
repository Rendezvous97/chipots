import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { artImage, preloadArt } from './art'
import { generateCell, hitResource, visibleResources } from './cellGen.mjs'

type Props = {
  worldX: number
  worldY: number
  worldSeed: number
  collected: Record<string, string>
  lifted: boolean
  onCollect?: (key: string, kind: string) => void
}

export function GameCanvas({
  worldX,
  worldY,
  worldSeed,
  collected,
  lifted,
  onCollect,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const propsRef = useRef({
    worldX,
    worldY,
    worldSeed,
    collected,
    lifted,
    onCollect,
  })
  propsRef.current = {
    worldX,
    worldY,
    worldSeed,
    collected,
    lifted,
    onCollect,
  }

  useEffect(() => {
    preloadArt()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0

    const draw = (now: number) => {
      const { worldX: vx, worldY: vy, worldSeed: seed, collected: taken } = propsRef.current
      const parent = canvas.parentElement
      const w = parent?.clientWidth || window.innerWidth
      const h = parent?.clientHeight || window.innerHeight
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr)
        canvas.height = Math.floor(h * dpr)
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const view = generateCell(vx, vy, seed)
      const bg = artImage(view.background ?? view.special ?? 'grass')
      if (bg) {
        drawCover(ctx, bg, w, h)
      } else {
        ctx.fillStyle = '#5ea14a'
        ctx.fillRect(0, 0, w, h)
      }

      const pulse = 1 + Math.sin(now / 280) * 0.04
      for (const item of visibleResources(view, taken)) {
        drawSprite(
          ctx,
          item.kind,
          item.x * w,
          item.y * h,
          item.scale * Math.min(w, h) * pulse,
        )
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const { worldX: vx, worldY: vy, worldSeed: seed, collected: taken, lifted: up, onCollect: collect } =
      propsRef.current
    if (up || !collect) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const nx = (event.clientX - rect.left) / rect.width
    const ny = (event.clientY - rect.top) / rect.height
    const view = generateCell(vx, vy, seed)
    const hit = hitResource(view, taken, nx, ny)
    if (!hit?.key) return
    event.preventDefault()
    collect(hit.key, hit.kind)
  }

  return (
    <canvas
      ref={canvasRef}
      className="game-canvas"
      onPointerDown={onPointerDown}
    />
  )
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
) {
  const ir = img.width / img.height
  const cr = w / h
  let dw: number
  let dh: number
  if (ir > cr) {
    dh = h
    dw = dh * ir
  } else {
    dw = w
    dh = dw / ir
  }
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  kind: string,
  cx: number,
  cy: number,
  size: number,
) {
  const img = artImage(kind)
  if (!img) return
  const ir = img.width / img.height
  let dw: number
  let dh: number
  if (ir >= 1) {
    dw = size
    dh = size / ir
  } else {
    dh = size
    dw = size * ir
  }
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh)
}
