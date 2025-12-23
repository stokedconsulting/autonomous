/**
 * ReviewPage - PR review queue management
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { Header } from '../organisms/Header.js';
import { HelpOverlay } from '../organisms/HelpOverlay.js';
import { Divider } from '../atoms/Divider.js';
import { TimeAgo } from '../atoms/TimeAgo.js';
import { useUIStore } from '../stores/ui-store.js';
import { useKeyboardNav } from '../hooks/useKeyboardNav.js';

interface ReviewItem {
  id: string;
  issueNumber: number;
  title: string;
  prUrl: string;
  status: 'pending' | 'approved' | 'changes-requested' | 'merged';
  author: string;
  createdAt: Date;
  checksStatus: 'passing' | 'failing' | 'pending';
}

const REVIEW_STATUS_COLORS: Record<string, string> = {
  'pending': 'yellow',
  'approved': 'green',
  'changes-requested': 'red',
  'merged': 'blue',
};

export function ReviewPage(): React.ReactElement {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const selectedIndex = useUIStore((s) => s.selectedIndex);

  useKeyboardNav({
    enableVimNav: true,
    maxItems: reviews.length,
    handlers: [
      {
        key: 'a',
        handler: () => {
          const selected = reviews[selectedIndex];
          if (selected && selected.status === 'pending') {
            setReviews(prev => prev.map(r =>
              r.id === selected.id ? { ...r, status: 'approved' as const } : r
            ));
          }
        },
      },
      {
        key: 'm',
        handler: () => {
          const selected = reviews[selectedIndex];
          if (selected && selected.status === 'approved') {
            setReviews(prev => prev.map(r =>
              r.id === selected.id ? { ...r, status: 'merged' as const } : r
            ));
          }
        },
      },
    ],
  });

  // Mock loading reviews
  useEffect(() => {
    const timer = setTimeout(() => {
      setReviews([
        {
          id: '1',
          issueNumber: 42,
          title: 'Add authentication middleware',
          prUrl: 'https://github.com/example/repo/pull/123',
          status: 'pending',
          author: 'claude-opus',
          createdAt: new Date(Date.now() - 3600000),
          checksStatus: 'passing',
        },
        {
          id: '2',
          issueNumber: 43,
          title: 'Implement rate limiting',
          prUrl: 'https://github.com/example/repo/pull/124',
          status: 'approved',
          author: 'claude-sonnet',
          createdAt: new Date(Date.now() - 7200000),
          checksStatus: 'passing',
        },
      ]);
      setLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const pendingCount = reviews.filter(r => r.status === 'pending').length;
  const approvedCount = reviews.filter(r => r.status === 'approved').length;

  return (
    <Box flexDirection="column">
      <Header />
      <HelpOverlay />

      <Box flexDirection="column" padding={1}>
        {/* Summary */}
        <Box borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
          <Box gap={3}>
            <Text bold>Review Queue</Text>
            <Text color="yellow">Pending: {pendingCount}</Text>
            <Text color="green">Approved: {approvedCount}</Text>
          </Box>
        </Box>

        <Divider title="Pull Requests" />

        {loading ? (
          <Box gap={1}>
            <Spinner label="Loading review queue..." />
          </Box>
        ) : reviews.length === 0 ? (
          <Box padding={1}>
            <Text dimColor>No PRs in review queue. All caught up! 🎉</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {reviews.map((review, index) => {
              const isFocused = index === selectedIndex;
              return (
                <Box
                  key={review.id}
                  flexDirection="column"
                  borderStyle="round"
                  borderColor={isFocused ? 'cyan' : 'gray'}
                  paddingX={1}
                  marginBottom={1}
                >
                  {/* Header */}
                  <Box justifyContent="space-between">
                    <Box gap={1}>
                      <Text color={isFocused ? 'cyan' : 'white'}>
                        {isFocused ? '▸ ' : '  '}
                      </Text>
                      <Text color="yellow" bold>#{review.issueNumber}</Text>
                      <Text bold>{review.title}</Text>
                    </Box>
                    <Text color={REVIEW_STATUS_COLORS[review.status]}>
                      {review.status.toUpperCase()}
                    </Text>
                  </Box>

                  {/* Details */}
                  <Box marginLeft={2} gap={2}>
                    <Text dimColor>Author: {review.author}</Text>
                    <Text dimColor>│</Text>
                    <Text color={review.checksStatus === 'passing' ? 'green' : 'red'}>
                      CI: {review.checksStatus === 'passing' ? '✓' : '✗'}
                    </Text>
                    <Text dimColor>│</Text>
                    <TimeAgo date={review.createdAt} />
                  </Box>

                  {/* Actions hint when focused */}
                  {isFocused && review.status === 'pending' && (
                    <Box marginLeft={2} marginTop={1}>
                      <Text color="green">a</Text>
                      <Text dimColor>: approve  </Text>
                      <Text color="yellow">c</Text>
                      <Text dimColor>: request changes  </Text>
                      <Text color="blue">o</Text>
                      <Text dimColor>: open in browser</Text>
                    </Box>
                  )}
                  {isFocused && review.status === 'approved' && (
                    <Box marginLeft={2} marginTop={1}>
                      <Text color="green">m</Text>
                      <Text dimColor>: merge  </Text>
                      <Text color="blue">o</Text>
                      <Text dimColor>: open in browser</Text>
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            j/k: navigate │ a: approve │ m: merge │ o: open │ ?: help
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
