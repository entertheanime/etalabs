'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { softenEtaSwapImage } from '@/lib/etaSwapArt';

interface SafeImageProps {
  src: string;
  alt: string;
  fill?: boolean;
  sizes?: string;
  className?: string;
  onError?: () => void;
  placeholder?: string;
  priority?: boolean;
  width?: number;
  height?: number;
}

export default function SafeImage({ 
  src, 
  alt, 
  onError,
  placeholder = '/placeholder.svg',
  className = '',
  width,
  height,
  fill,
  ...props 
}: SafeImageProps) {
  const [imgSrc, setImgSrc] = useState(softenEtaSwapImage(src || placeholder));
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
    setImgSrc(softenEtaSwapImage(src || placeholder));
  }, [src, placeholder]);

  const handleImageError = () => {
    if (!hasError && !imgSrc.includes('/placeholder.svg')) {
      console.log('🖼️ Image failed to load, using placeholder for:', alt);
      console.log('🔗 Failed URL:', imgSrc);
      setHasError(true);
      setImgSrc(placeholder);
      onError?.();
    }
  };

  // Don't render if no src and no placeholder
  if (!imgSrc) {
    return (
      <div className={`bg-gray-300 dark:bg-gray-800 flex items-center justify-center ${className}`}>
        <span className="text-gray-400 text-xs">No Image</span>
      </div>
    );
  }

  // Check if it's an external URL (like Reservoir Tools) or contains video formats
  const isExternalUrl = imgSrc.startsWith('http') || imgSrc.startsWith('https');
  const isVideo = imgSrc.endsWith('.mp4') || imgSrc.endsWith('.webm') || imgSrc.endsWith('.mov');
  const isLocalAsset = imgSrc.startsWith('/') && !imgSrc.startsWith('http');
  
  // Handle video files
  if (isVideo) {
    return (
      <video
        src={imgSrc}
        className={className}
        autoPlay
        loop
        muted
        playsInline
        onError={handleImageError}
        style={{
          objectFit: 'cover',
          width: '100%',
          height: '100%'
        }}
      />
    );
  }
  
  // Use regular img tag for external URLs or when no dimensions are provided
  if (isExternalUrl || (!width && !height && !fill)) {
    return (
      <img
        src={imgSrc}
        alt={alt}
        className={className}
        onError={handleImageError}
        style={{
          objectFit: 'cover',
          width: '100%',
          height: '100%'
        }}
      />
    );
  }

  // Use Next.js Image for local assets with proper dimensions
  return (
    <Image
      {...props}
      src={imgSrc}
      alt={alt}
      className={className}
      width={width}
      height={height}
      fill={fill}
      onError={handleImageError}
      style={{
        objectFit: 'cover'
      }}
    />
  );
} 