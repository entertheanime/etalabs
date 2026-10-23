'use client';

interface MobileMenuButtonProps {
  onClick: () => void;
  isOpen?: boolean;
}

export default function MobileMenuButton({ onClick, isOpen = false }: MobileMenuButtonProps) {
  return (
    <button
      onClick={onClick}
      className="lg:hidden p-2 hover:bg-zinc-800 rounded-lg transition-colors"
      aria-label="Toggle menu"
    >
      <svg 
        className="w-5 h-5 text-zinc-400" 
        fill="none" 
        stroke="currentColor" 
        viewBox="0 0 24 24"
      >
        {isOpen ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        )}
      </svg>
    </button>
  );
} 