/**
 * Current Instrument Store V6
 * Reactive store for accessing current track's instrument info anywhere in the app
 * Updated automatically by instrumentDisplayCoordinator
 */

import type { InstrumentInfo, InstrumentType } from '$lib/services/instrumentService';

class CurrentInstrumentStore {
  // Current instrument info (reactive)
  private instrument = $state<InstrumentInfo | null>(null);

  // Identified instrument type (reactive, derived from instrument)
  private instrumentType = $state<InstrumentType | null>(null);

  /**
   * Update the current instrument
   * Called by instrumentDisplayCoordinator
   */
  setInstrument(instrument: InstrumentInfo | null, type: InstrumentType | null) {
    this.instrument = instrument;
    this.instrumentType = type;
  }

  /**
   * Clear the current instrument
   */
  clear() {
    this.instrument = null;
    this.instrumentType = null;
  }

  /**
   * Get current instrument (reactive)
   */
  get current(): InstrumentInfo | null {
    return this.instrument;
  }

  /**
   * Get current instrument type (reactive)
   */
  get type(): InstrumentType | null {
    return this.instrumentType;
  }

  /**
   * Check if an instrument is currently loaded (reactive)
   */
  get hasInstrument(): boolean {
    return this.instrument !== null;
  }

  /**
   * Get device index of current instrument (reactive)
   */
  get deviceIndex(): number | null {
    return this.instrument?.deviceIndex ?? null;
  }

  /**
   * Get class name of current instrument (reactive)
   */
  get className(): string | null {
    return this.instrument?.className ?? null;
  }

  /**
   * Get name of current instrument (reactive)
   */
  get name(): string | null {
    return this.instrument?.name ?? null;
  }

  /**
   * Check if current instrument matches a specific type (reactive)
   */
  isType(type: InstrumentType): boolean {
    return this.instrumentType === type;
  }
}

// Export singleton instance
export const currentInstrumentStore = new CurrentInstrumentStore();