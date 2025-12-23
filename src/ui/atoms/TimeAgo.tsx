/**
 * TimeAgo - Relative time display with live updates
 */

import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

interface TimeAgoProps {
  date: Date | string;
  live?: boolean;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function TimeAgo({ date, live = true }: TimeAgoProps): React.ReactElement {
  const parsedDate = typeof date === 'string' ? new Date(date) : date;
  const [timeAgo, setTimeAgo] = useState(() => formatTimeAgo(parsedDate));

  useEffect(() => {
    if (!live) return;

    const interval = setInterval(() => {
      setTimeAgo(formatTimeAgo(parsedDate));
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [parsedDate, live]);

  return <Text dimColor>{timeAgo}</Text>;
}
