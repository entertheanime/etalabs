import React from 'react';

interface EnhancedVerifiedBadgeProps {
  isWhitelisted: boolean;
  isBlockchainVerified: boolean;
  verificationMethod: 'blockchain' | 'whitelist' | 'both' | 'none';
  name?: string;
  showDetails?: boolean;
}

const EnhancedVerifiedBadge: React.FC<EnhancedVerifiedBadgeProps> = ({
  isWhitelisted,
  isBlockchainVerified,
  verificationMethod,
  name,
  showDetails = false
}) => {
  const getBadgeColor = () => {
    switch (verificationMethod) {
      case 'both':
        return 'bg-green-500 text-white';
      case 'whitelist':
        return 'bg-blue-500 text-white';
      case 'blockchain':
        return 'bg-purple-500 text-white';
      default:
        return 'bg-gray-400 text-white';
    }
  };

  const getBadgeText = () => {
    switch (verificationMethod) {
      case 'both':
        return 'Verified';
      case 'whitelist':
        return 'Whitelisted';
      case 'blockchain':
        return 'Blockchain Verified';
      default:
        return 'Not Verified';
    }
  };

  const getIcon = () => {
    switch (verificationMethod) {
      case 'both':
        return (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        );
      case 'whitelist':
        return (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        );
      case 'blockchain':
        return (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
          </svg>
        );
      default:
        return (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        );
    }
  };

  return (
    <div className="flex items-center gap-2">
      {name && <span className="text-sm text-gray-600 dark:text-gray-300 mr-1">{name}</span>}
      
      <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getBadgeColor()}`}>
        {getIcon()}
        <span>{getBadgeText()}</span>
      </div>

      {showDetails && (
        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
          {isWhitelisted && (
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              Whitelist
            </span>
          )}
          {isBlockchainVerified && (
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
              Blockchain
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default EnhancedVerifiedBadge; 