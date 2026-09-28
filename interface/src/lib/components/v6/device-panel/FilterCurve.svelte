<script lang="ts">
  import { FilterResponseCalculator, type FilterType as CalcFilterType } from '$lib/utils/filterResponseCalculator';
  import { DEVICE_FAMILY_INKS } from '$lib/config/devicePresets';

  export type CurveType = 'lowpass' | 'highpass' | 'bandpass' | 'bandpass-flat' | 'notch' | 'peak' | 'lowshelf' | 'highshelf' | 'eq' | 'none';

  export interface FilterDot {
    freq: number;      // 0-1 normalized frequency
    resonance: number; // 0-1 Q factor
    type: 'lowpass' | 'highpass'; // Filter type for dot color
    color?: string;    // Optional custom color
  }

  interface Props {
    cutoff?: number; // 0-1 normalized frequency
    resonance?: number; // 0-1 Q factor
    curveType?: CurveType;
    bands?: { freq: number; gain: number; q?: number; type?: string }[]; // For EQ type with band types
    filterDots?: FilterDot[]; // For displaying multiple filter positions (NEW)
    width?: number;
    height?: number;
    animate?: boolean;
    curveColor?: string;
  }

  let {
    cutoff = 0.5,
    resonance = 0,
    curveType = 'lowpass',
    bands = [],
    filterDots = [],
    width = 300,
    height = 300,
    // Off by default (2026-09-14): the `d` transition restarts on every
    // update, so under a drag the curve eased along behind the finger and
    // behind its own dots, which read as lag on every host (Echo graph, EQ
    // tile, XY pads). A recompute is 0.1 ms (measured, Mac) — drawing each
    // frame outright costs nothing. Opt in only for a curve nothing drags.
    animate = false,
    curveColor
  }: Props = $props();

  const gradientId = `curveGradient-${Math.random().toString(36).slice(2, 9)}`;

  // Initialize calculator
  const calculator = new FilterResponseCalculator(44100);

  // Generate logarithmic frequency points
  const frequencies = calculator.generateLogFrequencies(20, 20000, 200);

  // Convert frequencies to X coordinates
  const freqToX = (freq: number): number => {
    const logFreq = Math.log10(freq);
    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);
    return ((logFreq - logMin) / (logMax - logMin)) * width;
  };

  // Convert dB to Y coordinate
  const dbToY = (db: number): number => {
    const dbRange = 48; // -24 to +24 dB
    const normalized = (db + 24) / dbRange;
    return height - (normalized * height);
  };

  // Generate frequency response curve path
  let curvePath = $derived.by(() => {
    if (curveType === 'none') return '';

    let magnitudeResponse: number[];

    if (curveType === 'eq' && bands.length > 0) {
      // Multi-band parametric EQ with different filter types per band
      const filters = bands.map(band => ({
        type: (band.type || 'peak') as CalcFilterType,
        frequency: band.freq,
        sampleRate: 44100,
        Q: band.q || 1,
        gain: band.gain
      }));

      const response = calculator.calculateCombinedResponse(filters, frequencies);
      magnitudeResponse = response.magnitude;
    } else if (curveType === 'bandpass-flat') {
      // Flat-top bandpass = parallel HP + LP around center freq.
      // Width = fraction of a decade between shelves. resonance 1 → wide, 0 → narrow.
      const center = calculator.normalizedToFrequency(cutoff);
      const widthDecades = 1.8 * resonance + 0.05; // 0.05–1.85 decades
      const spread = Math.pow(10, widthDecades / 2);
      const hpFreq = Math.max(20, center / spread);
      const lpFreq = Math.min(20000, center * spread);
      const Q = 0.7071;

      const hp = calculator.calculateCoefficients({ type: 'highpass', frequency: hpFreq, sampleRate: 44100, Q });
      const lp = calculator.calculateCoefficients({ type: 'lowpass', frequency: lpFreq, sampleRate: 44100, Q });
      const hpR = calculator.calculateFrequencyResponse(hp, frequencies);
      const lpR = calculator.calculateFrequencyResponse(lp, frequencies);
      magnitudeResponse = hpR.magnitude.map((m, i) => m + lpR.magnitude[i]);
    } else if (curveType !== 'eq') {
      // Single filter response
      const frequency = calculator.normalizedToFrequency(cutoff);
      const Q = calculator.normalizedToQ(resonance, 0.5, 30);

      const filterType = curveType === 'lowshelf' || curveType === 'highshelf' || curveType === 'peak'
        ? curveType
        : curveType as CalcFilterType;

      const coeffs = calculator.calculateCoefficients({
        type: filterType,
        frequency,
        sampleRate: 44100,
        Q,
        gain: curveType === 'peak' ? 12 : 0 // Default gain for peaking filters
      });

      const response = calculator.calculateFrequencyResponse(coeffs, frequencies);
      magnitudeResponse = response.magnitude;
    } else {
      return '';
    }

    // Generate SVG path
    const points = frequencies.map((freq, i) => {
      const x = freqToX(freq);
      const y = dbToY(magnitudeResponse[i]);
      return [x, y];
    });

    if (points.length === 0) return '';

    // Create smooth path with cubic bezier interpolation
    let path = `M ${points[0][0]} ${points[0][1]}`;

    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];

      // Use cubic bezier for smooth curves
      const cpx = (x0 + x1) / 2;
      path += ` Q ${cpx} ${y0} ${x1} ${y1}`;
    }

    return path;
  });
</script>

<svg
  class="filter-curve"
  viewBox="0 0 {width} {height}"
  preserveAspectRatio="none"
  style="width: 100%; height: 100%;{curveColor ? ` --curve-color: ${curveColor};` : ''}"
>
  <!-- Definitions for gradients and filters -->
  <defs>
    <!-- Gradient for curve fill -->
    <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:{curveColor ?? 'var(--curve-color)'};stop-opacity:0.3" />
      <stop offset="100%" style="stop-color:{curveColor ?? 'var(--curve-color)'};stop-opacity:0" />
    </linearGradient>
  </defs>

  <!-- Filter response curve with fill -->
  {#if curvePath}
    <g class="response-group">
      <!-- Fill area under curve -->
      <path
        d={curvePath + ` L ${width} ${height} L 0 ${height} Z`}
        fill="url(#{gradientId})"
        class="response-fill"
      />

      <!-- Dual-stroke echo (§5.6): a thicker low-alpha second stroke BEHIND the
           main 2px luminous stroke — replaces the d-animating drop-shadow glow. -->
      <path
        d={curvePath}
        fill="none"
        stroke-width="5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="response-echo"
        class:animated={animate}
      />
      <path
        d={curvePath}
        fill="none"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="response-curve"
        class:animated={animate}
      />
    </g>
  {/if}


  <!-- Filter dots for multiple filters (NEW) -->
  {#if filterDots && filterDots.length > 0}
    {#each filterDots as dot}
      {@const dotFreqHz = calculator.normalizedToFrequency(dot.freq)}
      {@const dotX = freqToX(dotFreqHz)}
      {@const dotQ = calculator.normalizedToQ(dot.resonance, 0.5, 30)}
      <!-- Position dot by resonance (Y position), not on the curve -->
      {@const dotY = height - (dot.resonance * height)}
      {@const dotColor = dot.color || (dot.type === 'highpass' ? DEVICE_FAMILY_INKS.distortion.primary : DEVICE_FAMILY_INKS.filter.primary)}

      <!-- Dot on the curve (larger, more visible) -->
      <circle
        cx={dotX}
        cy={dotY}
        r="10"
        fill={dotColor}
        stroke="white"
        stroke-width="3"
        opacity="0.95"
        class="filter-dot-ring"
      />

      <!-- Inner dot -->
      <circle
        cx={dotX}
        cy={dotY}
        r="6"
        fill={dotColor}
        opacity="0.7"
        class="filter-dot-core"
      />
    {/each}
  {/if}
</svg>

<style>
  .filter-curve {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 1;
    --curve-color: var(--act-monitor);
  }

  /* Static SVG area-fill gradient under the curve at 15% (§5.6). */
  .response-fill {
    opacity: 0.15;
  }

  /* Dual-stroke echo replaces the d-animating drop-shadow glow (§5.6). */
  .response-echo {
    stroke: var(--curve-color);
    opacity: 0.22;
  }

  .response-curve {
    stroke: var(--curve-color);
  }

  /* KEEP the d transition (§5.6) — both strokes track the curve. */
  .response-curve.animated,
  .response-echo.animated {
    transition: d 0.05s linear;
  }

  .response-group {
    animation: fadeIn 0.3s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* ---- Flat grammar: a filter display is a single 2px curve over a flat
     solid area fill — no gradient, no glow echo. The classes below out-
     specify the SVG presentation attributes (fill="url(#…)", stroke="white"),
     so no !important is needed. The family ink comes from --curve-color.
     The dot handles drop the white halo for Live's dark contrast frame. */
  :global([data-grammar="flat"]) .response-echo {
    display: none;
  }
  :global([data-grammar="flat"]) .response-fill {
    fill: var(--curve-color);
    opacity: 0.12;
  }
  :global([data-grammar="flat"]) .filter-dot-ring {
    stroke: var(--line-strong);
    stroke-width: 2;
    opacity: 1;
  }
</style>
