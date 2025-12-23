/**
 * useKeyboardNav - Keyboard navigation hook with Vim-style bindings
 */

import { useInput } from 'ink';
import { useUIStore } from '../stores/ui-store.js';

interface KeyHandler {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  handler: () => void;
}

interface UseKeyboardNavOptions {
  handlers?: KeyHandler[];
  enableVimNav?: boolean;
  maxItems?: number;
  onQuit?: () => void;
}

export function useKeyboardNav(options: UseKeyboardNavOptions = {}): void {
  const { enableVimNav = true, handlers = [], maxItems = 0, onQuit } = options;
  const { toggleHelp, goBack, moveSelection } = useUIStore();

  useInput((input, key) => {
    // Global handlers
    if (input === '?') {
      toggleHelp();
      return;
    }

    if (input === 'q' && !key.ctrl) {
      if (onQuit) {
        onQuit();
      } else {
        goBack();
      }
      return;
    }

    if (key.escape) {
      goBack();
      return;
    }

    // Vim-style navigation
    if (enableVimNav && maxItems > 0) {
      if (input === 'j' || key.downArrow) {
        moveSelection(1, maxItems);
        return;
      }
      if (input === 'k' || key.upArrow) {
        moveSelection(-1, maxItems);
        return;
      }
      if (input === 'g') {
        useUIStore.getState().setSelectedIndex(0);
        return;
      }
      if (input === 'G') {
        useUIStore.getState().setSelectedIndex(maxItems - 1);
        return;
      }
    }

    // Page navigation with Ctrl+d/u
    if (key.ctrl && enableVimNav && maxItems > 0) {
      if (input === 'd') {
        moveSelection(5, maxItems);
        return;
      }
      if (input === 'u') {
        moveSelection(-5, maxItems);
        return;
      }
    }

    // Custom handlers
    for (const handler of handlers) {
      const keyMatch = input === handler.key;
      const ctrlMatch = handler.ctrl ? key.ctrl : !key.ctrl;
      const shiftMatch = handler.shift !== undefined ? handler.shift === key.shift : true;

      if (keyMatch && ctrlMatch && shiftMatch) {
        handler.handler();
        return;
      }
    }
  });
}
