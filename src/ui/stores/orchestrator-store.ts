/**
 * Orchestrator Store - LLM instance management
 */

import { create } from 'zustand';

export type OrchestratorStatus = 'idle' | 'starting' | 'running' | 'stopping';

interface LogEntry {
  timestamp: Date;
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug';
}

interface LLMInstance {
  id: string;
  provider: string;
  issueNumber: number;
  status: 'starting' | 'running' | 'stopping' | 'stopped';
  startedAt: Date;
  cpuHistory: number[];
  memoryMB: number;
}

interface OrchestratorState {
  // State
  status: OrchestratorStatus;
  instances: Map<string, LLMInstance>;
  logs: Map<string, LogEntry[]>;
  config: {
    verbose: boolean;
    dryRun: boolean;
    epicName?: string;
    autoMerge: boolean;
  };

  // Actions
  setStatus: (status: OrchestratorStatus) => void;
  addInstance: (instance: LLMInstance) => void;
  updateInstance: (id: string, update: Partial<LLMInstance>) => void;
  removeInstance: (id: string) => void;
  addLog: (instanceId: string, entry: LogEntry) => void;
  clearLogs: (instanceId: string) => void;
  setConfig: (config: Partial<OrchestratorState['config']>) => void;
  reset: () => void;

  // Getters
  getInstance: (id: string) => LLMInstance | undefined;
  getLogs: (instanceId: string) => LogEntry[];
  getActiveInstances: () => LLMInstance[];
}

const initialConfig = {
  verbose: false,
  dryRun: false,
  autoMerge: false,
};

export const useOrchestratorStore = create<OrchestratorState>((set, get) => ({
  status: 'idle',
  instances: new Map(),
  logs: new Map(),
  config: { ...initialConfig },

  setStatus: (status) => set({ status }),

  addInstance: (instance) => set((state) => {
    const newInstances = new Map(state.instances);
    newInstances.set(instance.id, instance);
    return { instances: newInstances };
  }),

  updateInstance: (id, update) => set((state) => {
    const instance = state.instances.get(id);
    if (!instance) return state;

    const newInstances = new Map(state.instances);
    newInstances.set(id, { ...instance, ...update });
    return { instances: newInstances };
  }),

  removeInstance: (id) => set((state) => {
    const newInstances = new Map(state.instances);
    newInstances.delete(id);
    return { instances: newInstances };
  }),

  addLog: (instanceId, entry) => set((state) => {
    const newLogs = new Map(state.logs);
    const existing = newLogs.get(instanceId) || [];
    // Keep last 500 logs per instance
    const updated = [...existing, entry].slice(-500);
    newLogs.set(instanceId, updated);
    return { logs: newLogs };
  }),

  clearLogs: (instanceId) => set((state) => {
    const newLogs = new Map(state.logs);
    newLogs.delete(instanceId);
    return { logs: newLogs };
  }),

  setConfig: (config) => set((state) => ({
    config: { ...state.config, ...config },
  })),

  reset: () => set({
    status: 'idle',
    instances: new Map(),
    logs: new Map(),
    config: { ...initialConfig },
  }),

  getInstance: (id) => get().instances.get(id),

  getLogs: (instanceId) => get().logs.get(instanceId) || [],

  getActiveInstances: () => {
    const instances = get().instances;
    return Array.from(instances.values()).filter(
      i => i.status === 'running' || i.status === 'starting'
    );
  },
}));
