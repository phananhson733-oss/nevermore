import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware class combiner (clsx + tailwind-merge). Legacy code keeps `cx`. */
export function cn(...inputs: readonly ClassValue[]): string {
  return twMerge(clsx(inputs));
}
