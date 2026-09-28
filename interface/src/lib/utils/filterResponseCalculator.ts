/**
 * Filter Response Calculator
 * Implements accurate DSP calculations for biquad filter coefficients and frequency response
 * Based on Robert Bristow-Johnson's Audio EQ Cookbook formulas
 */

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peak' | 'lowshelf' | 'highshelf' | 'allpass';

export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
}

export interface FilterParameters {
  type: FilterType;
  frequency: number; // Hz
  sampleRate: number; // Hz
  Q?: number; // Quality factor (default: 0.7071)
  gain?: number; // dB (for peak and shelf filters)
  bandwidth?: number; // octaves (alternative to Q)
}

export class FilterResponseCalculator {
  private sampleRate: number;

  constructor(sampleRate: number = 44100) {
    this.sampleRate = sampleRate;
  }

  /**
   * Calculate biquad filter coefficients based on filter parameters
   */
  calculateCoefficients(params: FilterParameters): BiquadCoefficients {
    const { type, frequency, sampleRate, Q = 0.7071, gain = 0 } = params;

    // Intermediate variables
    const w0 = 2 * Math.PI * frequency / sampleRate;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);

    // Alpha calculation varies by parameter type
    let alpha: number;
    if (params.bandwidth !== undefined) {
      // BW in octaves
      alpha = sinw0 * Math.sinh(Math.log(2) / 2 * params.bandwidth * w0 / sinw0);
    } else {
      // Q factor
      alpha = sinw0 / (2 * Q);
    }

    // For peaking and shelving filters
    const A = Math.pow(10, gain / 40);
    const sqrt2A = Math.sqrt(2 * A);

    let b0 = 0, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

    switch (type) {
      case 'lowpass':
        b0 = (1 - cosw0) / 2;
        b1 = 1 - cosw0;
        b2 = (1 - cosw0) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosw0;
        a2 = 1 - alpha;
        break;

      case 'highpass':
        b0 = (1 + cosw0) / 2;
        b1 = -(1 + cosw0);
        b2 = (1 + cosw0) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosw0;
        a2 = 1 - alpha;
        break;

      case 'bandpass':
        b0 = sinw0 / 2;
        b1 = 0;
        b2 = -sinw0 / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosw0;
        a2 = 1 - alpha;
        break;

      case 'notch':
        b0 = 1;
        b1 = -2 * cosw0;
        b2 = 1;
        a0 = 1 + alpha;
        a1 = -2 * cosw0;
        a2 = 1 - alpha;
        break;

      case 'peak':
        b0 = 1 + alpha * A;
        b1 = -2 * cosw0;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cosw0;
        a2 = 1 - alpha / A;
        break;

      case 'lowshelf':
        b0 = A * ((A + 1) - (A - 1) * cosw0 + sqrt2A * alpha);
        b1 = 2 * A * ((A - 1) - (A + 1) * cosw0);
        b2 = A * ((A + 1) - (A - 1) * cosw0 - sqrt2A * alpha);
        a0 = (A + 1) + (A - 1) * cosw0 + sqrt2A * alpha;
        a1 = -2 * ((A - 1) + (A + 1) * cosw0);
        a2 = (A + 1) + (A - 1) * cosw0 - sqrt2A * alpha;
        break;

      case 'highshelf':
        b0 = A * ((A + 1) + (A - 1) * cosw0 + sqrt2A * alpha);
        b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
        b2 = A * ((A + 1) + (A - 1) * cosw0 - sqrt2A * alpha);
        a0 = (A + 1) - (A - 1) * cosw0 + sqrt2A * alpha;
        a1 = 2 * ((A - 1) - (A + 1) * cosw0);
        a2 = (A + 1) - (A - 1) * cosw0 - sqrt2A * alpha;
        break;

      case 'allpass':
        b0 = 1 - alpha;
        b1 = -2 * cosw0;
        b2 = 1 + alpha;
        a0 = 1 + alpha;
        a1 = -2 * cosw0;
        a2 = 1 - alpha;
        break;
    }

    // Normalize coefficients
    return {
      b0: b0 / a0,
      b1: b1 / a0,
      b2: b2 / a0,
      a0: 1,
      a1: a1 / a0,
      a2: a2 / a0
    };
  }

  /**
   * Calculate frequency response (magnitude and phase) for given coefficients
   */
  calculateFrequencyResponse(
    coeffs: BiquadCoefficients,
    frequencies: number[],
    sampleRate: number = this.sampleRate
  ): { magnitude: number[], phase: number[] } {
    const magnitude: number[] = [];
    const phase: number[] = [];

    for (const freq of frequencies) {
      const w = 2 * Math.PI * freq / sampleRate;
      const cosw = Math.cos(w);
      const sinw = Math.sin(w);
      const cos2w = Math.cos(2 * w);
      const sin2w = Math.sin(2 * w);

      // Calculate complex numerator (b0 + b1*z^-1 + b2*z^-2)
      const numReal = coeffs.b0 + coeffs.b1 * cosw + coeffs.b2 * cos2w;
      const numImag = -coeffs.b1 * sinw - coeffs.b2 * sin2w;

      // Calculate complex denominator (1 + a1*z^-1 + a2*z^-2)
      const denReal = 1 + coeffs.a1 * cosw + coeffs.a2 * cos2w;
      const denImag = -coeffs.a1 * sinw - coeffs.a2 * sin2w;

      // Complex division
      const denMagSq = denReal * denReal + denImag * denImag;
      const respReal = (numReal * denReal + numImag * denImag) / denMagSq;
      const respImag = (numImag * denReal - numReal * denImag) / denMagSq;

      // Calculate magnitude in dB
      const mag = Math.sqrt(respReal * respReal + respImag * respImag);
      magnitude.push(20 * Math.log10(Math.max(mag, 0.00001))); // Avoid log(0)

      // Calculate phase in radians
      phase.push(Math.atan2(respImag, respReal));
    }

    return { magnitude, phase };
  }

  /**
   * Generate logarithmically spaced frequencies for smooth visualization
   */
  generateLogFrequencies(
    minFreq: number = 20,
    maxFreq: number = 20000,
    numPoints: number = 200
  ): number[] {
    const frequencies: number[] = [];
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);

    for (let i = 0; i < numPoints; i++) {
      const logFreq = logMin + (logMax - logMin) * i / (numPoints - 1);
      frequencies.push(Math.pow(10, logFreq));
    }

    return frequencies;
  }

  /**
   * Calculate combined response for multiple filters (e.g., parametric EQ)
   */
  calculateCombinedResponse(
    filters: FilterParameters[],
    frequencies: number[]
  ): { magnitude: number[], phase: number[] } {
    const combinedMagnitude = new Array(frequencies.length).fill(0);
    const combinedPhase = new Array(frequencies.length).fill(0);

    for (const filter of filters) {
      const coeffs = this.calculateCoefficients(filter);
      const response = this.calculateFrequencyResponse(coeffs, frequencies, filter.sampleRate || this.sampleRate);

      // Add magnitudes (in dB) and phases (in radians)
      for (let i = 0; i < frequencies.length; i++) {
        combinedMagnitude[i] += response.magnitude[i];
        combinedPhase[i] += response.phase[i];
      }
    }

    return { magnitude: combinedMagnitude, phase: combinedPhase };
  }

  /**
   * Convert normalized cutoff (0-1) to frequency in Hz
   */
  normalizedToFrequency(normalized: number, minFreq: number = 20, maxFreq: number = 20000): number {
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);
    return Math.pow(10, logMin + normalized * (logMax - logMin));
  }

  /**
   * Convert normalized Q (0-1) to actual Q factor
   */
  normalizedToQ(normalized: number, minQ: number = 0.1, maxQ: number = 30): number {
    // Use exponential scaling for more musical Q response
    return minQ * Math.pow(maxQ / minQ, normalized);
  }

  /**
   * Convert normalized gain (0-1) to dB (-24 to +24)
   */
  normalizedToGain(normalized: number, maxGain: number = 24): number {
    return (normalized - 0.5) * 2 * maxGain;
  }
}