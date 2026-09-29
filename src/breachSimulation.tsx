import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AssistantReference } from "./designAssistant";

export interface BreachSimulationPlan {
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  steps: AssistantReference[];
  mitigations: string[];
}

type SimulationStatus = "idle" | "playing" | "paused" | "complete";

interface BreachSimulationApi {
  plan: BreachSimulationPlan | null;
  status: SimulationStatus;
  currentStepIndex: number;
  activeReferenceKeys: Set<string>;
  currentReferenceKey: string | null;
  start: (plan: BreachSimulationPlan) => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
}

const BreachSimulationContext = createContext<BreachSimulationApi | null>(null);

function referenceKey(reference: AssistantReference): string {
  return `${reference.kind}:${reference.id}`;
}

export function BreachSimulationProvider({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<BreachSimulationPlan | null>(null);
  const [status, setStatus] = useState<SimulationStatus>("idle");
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);

  useEffect(() => {
    if (status !== "playing" || !plan) return;
    const timer = window.setTimeout(() => {
      if (currentStepIndex >= plan.steps.length - 1) {
        setStatus("complete");
        return;
      }
      setCurrentStepIndex((current) => current + 1);
    }, currentStepIndex < 0 ? 150 : 900);
    return () => window.clearTimeout(timer);
  }, [currentStepIndex, plan, status]);

  const activeReferenceKeys = useMemo(() => {
    if (!plan || currentStepIndex < 0) return new Set<string>();
    return new Set(
      plan.steps.slice(0, currentStepIndex + 1).map(referenceKey),
    );
  }, [currentStepIndex, plan]);

  const currentReferenceKey =
    plan && currentStepIndex >= 0
      ? referenceKey(plan.steps[currentStepIndex])
      : null;

  const value = useMemo<BreachSimulationApi>(
    () => ({
      plan,
      status,
      currentStepIndex,
      activeReferenceKeys,
      currentReferenceKey,
      start: (nextPlan) => {
        setPlan(nextPlan);
        setCurrentStepIndex(-1);
        setStatus("playing");
      },
      pause: () => setStatus((current) => current === "playing" ? "paused" : current),
      resume: () => setStatus((current) => current === "paused" ? "playing" : current),
      reset: () => {
        setPlan(null);
        setCurrentStepIndex(-1);
        setStatus("idle");
      },
    }),
    [activeReferenceKeys, currentReferenceKey, currentStepIndex, plan, status],
  );

  return (
    <BreachSimulationContext.Provider value={value}>
      {children}
    </BreachSimulationContext.Provider>
  );
}

export function useBreachSimulation(): BreachSimulationApi {
  const value = useContext(BreachSimulationContext);
  if (!value) {
    throw new Error("useBreachSimulation must be used inside BreachSimulationProvider");
  }
  return value;
}