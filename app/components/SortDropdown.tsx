"use client";

import React, { useEffect, useRef, useState } from "react";

type SortValue = "floor-asc" | "floor-desc";

interface SortDropdownProps {
  value: SortValue;
  onChange: (val: SortValue) => void;
  className?: string;
}

export default function SortDropdown({ value, onChange, className = "" }: SortDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const items: { val: SortValue; label: string }[] = [
    { val: "floor-asc", label: "Price: Low to High" },
    { val: "floor-desc", label: "Price: High to Low" },
  ];

  const current = items.find((i) => i.val === value)?.label ?? items[0].label;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white hover:bg-zinc-900/80 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
      >
        <span>{current}</span>
        <svg className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-xl border border-zinc-800 bg-zinc-900/95 backdrop-blur-md shadow-2xl z-50">
          <ul className="py-1">
            {items.map((item) => (
              <li key={item.val}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(item.val);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-zinc-800/70 ${
                    value === item.val ? "text-white" : "text-zinc-300"
                  }`}
                >
                  {value === item.val ? "✓ " : ""}
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

