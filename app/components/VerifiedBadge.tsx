interface VerifiedBadgeProps {
  name?: string;
}

const VerifiedBadge = ({ name }: VerifiedBadgeProps) => (
  <div className="flex items-center">
    {name && <span className="text-sm text-blue-500 mr-1">{name}</span>}
    <svg
      className="w-4 h-4 text-blue-500"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  </div>
);

export default VerifiedBadge; 