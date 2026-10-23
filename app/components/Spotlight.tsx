'use client';

import { useRef, type MouseEvent, type ReactNode } from 'react';

export default function Spotlight({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const spot = useRef<HTMLDivElement>(null);

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = spot.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const mask = `radial-gradient(circle at ${x}px ${y}px, #000 0px, rgba(0,0,0,0.2) 80px, rgba(0,0,0,0.05) 150px, transparent 260px)`;
    el.style.maskImage = mask;
    el.style.webkitMaskImage = mask;
  };

  return (
    <div className={`spotlight-host relative overflow-hidden ${className}`} onMouseMove={onMove}>
      <div ref={spot} className="spotlight-dots pointer-events-none absolute inset-0 z-0" />
      <div className="relative z-[2]">{children}</div>
    </div>
  );
}
