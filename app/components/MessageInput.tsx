"use client";

import React from 'react';

interface MessageInputProps {
  tradeMessage: string;
  setTradeMessage: (val: string) => void;
}

export default function MessageInput({ tradeMessage, setTradeMessage }: MessageInputProps) {
  return (
    <div className="glass-theme rounded-2xl p-6 mb-6">
      <label className="block text-gray-600 dark:text-gray-300 text-sm font-medium mb-2 transition-colors duration-300">
        Include a message with your offer:
      </label>
      <textarea
        value={tradeMessage}
        onChange={(e) => setTradeMessage(e.target.value)}
        placeholder="Optional message for the trade recipient..."
        className="w-full bg-white/50 dark:bg-gray-800/50 border border-white/20 dark:border-gray-600 rounded-xl px-3 py-2 text-gray-900 dark:text-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none transition-colors duration-300 backdrop-blur-sm"
        rows={3}
        maxLength={50}
      />
      <div className="text-xs text-gray-600 dark:text-gray-500 mt-1 transition-colors duration-300">
        {tradeMessage.length}/50 characters
      </div>
    </div>
  );
}

